---
doc_class: technical
audience: developer, operator, architect
publication: github
lifecycle: as-built
---

# Tenant Application Marketplace

Summary: Technical contracts for exposing deployment-installed plugins to one tenant at a time.

Audience: Plugin authors, host developers, operators, and security reviewers.

## Ownership boundary

The plugin manager and platform operator own acquisition, signature verification, installation,
upgrade, rollback, emergency disablement, and deployment-wide audit. A tenant never supplies an
OCI reference, registry credential, deployment target, entitlement document, or infrastructure
location.

The tenant marketplace owns only the current tenant's request and activation state. Every route
derives `tenantId` from authenticated tenant context. Request bodies contain no tenant selector,
and the persistence key is `(plugin_id, tenant_ref)`. A platform installation can therefore be
activated for tenant A while remaining inactive for tenant B.

## Permissions

| Action | Permission | Default tenant roles | Purpose |
| --- | --- | --- | --- |
| `tenant.apps.read` | `tenant:apps:view` | administrator, operator, viewer | Read the current tenant's safe catalogue, configuration link, and audit. |
| `tenant.apps.request` | `tenant:apps:request` | administrator, operator, viewer | Request activation when approval policy is enabled. |
| `tenant.apps.manage` | `tenant:apps:manage` | administrator | Activate, deactivate, approve, or reject for the current tenant. |
| `tenant.apps.use` | `tenant:apps:use` | administrator, operator, viewer | Use active plugin contributions. Runtime admission remains the enforcement point. |

Platform installation routes continue to require `platform.settings.read` or
`platform.settings.manage`. Installing a plugin does not make the platform operator a tenant
administrator.

## Safe catalogue

`GET /api/t/{tenantSlug}/apps` returns installed plugins whose signed manifest declares
`scope.enablement: tenant`. Each item contains only product identity, version, publisher, safe
health/compatibility/entitlement state, tenant activation state, optimistic revision, request
timestamps, and the plugin-owned configuration projection.

The projection deliberately excludes prices, commercial entitlements, registry and workload
credentials, image references, bundle paths, deployment topology, raw manifests, sibling-tenant
state, and raw entitlement documents.

A tenant settings contribution may declare `configurationSchema` as a bundle-relative path and
SHA-256 digest. The browser receives only that digest and the signed plugin-owned tenant route;
the host never treats marketplace metadata as configuration authority.

## Lifecycle

The safe statuses are `requested`, `entitled`, `install-pending`, `available`, `active`,
`inactive`, `blocked`, and `revoked`.

With the default `direct` policy, a tenant administrator activates or deactivates an available
application. With `approval_required`, a tenant member first creates a revision-protected request
and a tenant administrator approves or rejects it. Approval activates the application in the
same transaction. Every mutation requires a bounded idempotency key and `expectedRevision`.

```mermaid
stateDiagram-v2
  [*] --> Available: deployment installation ready
  Available --> Active: tenant admin activates (direct)
  Available --> Requested: member requests (approval_required)
  Requested --> Active: tenant admin approves
  Requested --> Inactive: tenant admin rejects
  Active --> Inactive: tenant admin deactivates
  Inactive --> Active: tenant admin activates (direct)
  Available --> Blocked: compatibility or entitlement gate fails
  Active --> Revoked: deployment entitlement revoked
```

Activation immediately controls frontend bootstrap, navigation, backend gateway calls, events,
and schedules through the existing tenant enablement gate. The marketplace does not load or
execute plugin code itself.

## Signed tenant eligibility

Plugins with `manifest.entitlement.provider: none` remain `not_required`; they do not need an
issuer or a cloud connection. Plugins with `provider: plugin` fail closed until the shard receives
a current ES256 projection for the exact tenant, plugin version, and immutable release digest.
The effective runtime decision is:

```text
release admitted
AND installation ready
AND tenant eligibility is trial, active, or grace
AND tenant activation enabled
AND user/resource authorization allowed
```

The cloud control plane sends the compact JWS only to the workload route
`PUT /api/workloads/tenants/{tenantId}/apps/{pluginId}/eligibility` using a service account with
`tenant:lifecycle`. The shard verifies the configured issuer, audience, `kid`, ES256 signature,
tenant, plugin, version, release digest, issuance/expiry, effective window, maximum lifetime, and
monotonic revision before storing anything. Reusing a revision with different signed content or
applying an older revision is rejected.

The database stores only the verified operational projection: tenant/plugin identity, version and
release binding, state, effective window, limits hash, issuer, expiry, revision, safe reference,
JWS identifier, and a signature digest. It never stores the compact JWS, price, plan, agreement,
payment data, or other commercial source fields. Tenant users can read the effective safe view at
`GET /api/t/{tenantSlug}/apps/{pluginId}/eligibility`; that response omits tenant identity and all
signature material.

`trial`, `active`, and `grace` permit new work. `unavailable`, `expired`, and `revoked` deny it.
JWS expiry and a future effective start project as `unavailable`; a passed business effective end
projects as `expired`. Interactive calls and every asynchronous delivery recheck the current state
immediately before dispatch, so a higher-revision revocation stops new work without removing
plugin-owned tenant data. A later eligible projection can reactivate the existing data after the
tenant activation gate is enabled.

## Configuration

Set `ENTERPRISEGLUE_TENANT_APP_ACTIVATION_POLICY` to:

- `direct` (default): tenant administrators activate and deactivate directly;
- `approval_required`: members request, then tenant administrators approve or reject.

Unknown values fail startup. The default preserves existing single-tenant and self-hosted plugin
behavior. The canonical enablement endpoint is
`/api/t/{tenantSlug}/plugin-platform/v1/plugins/{pluginId}/enablement`; the existing
`/t/{tenantSlug}/api/plugin-platform/v1/plugins/{pluginId}/enablement` endpoint remains an alias.

For plugin-provided eligibility, configure:

- `EG_TENANT_APP_ELIGIBILITY_REQUIRED=true` in SaaS shards. Partial configuration fails startup;
  ordinary self-hosted deployments may leave all eligibility settings unset.
- `EG_TENANT_APP_ELIGIBILITY_JWKS_JSON` with public P-256 ES256 keys and unique `kid` values.
- `EG_TENANT_APP_ELIGIBILITY_ISSUER` and `EG_TENANT_APP_ELIGIBILITY_AUDIENCE` with exact values.
- `EG_TENANT_APP_ELIGIBILITY_CLOCK_SKEW_SECONDS` from `0` to `300`; default `60`.
- `EG_TENANT_APP_ELIGIBILITY_MAX_LIFETIME_SECONDS` from `60` to `2592000`; default `604800`.

## Upgrade and rollback

Run database migrations `1700000000128-add-tenant-application-marketplace` and
`1700000000129-add-tenant-plugin-eligibility` before enabling the routes. They add request metadata,
an idempotent operation receipt table, the manifest entitlement-provider projection, and safe
tenant eligibility rows without changing deployment enablement defaults. Before rollback, disable
SaaS-required eligibility, deactivate tenant applications, and allow in-flight operations to
settle. The migration down paths remove only host marketplace/eligibility metadata; deployment
plugin records and plugin-owned tenant data remain intact.
