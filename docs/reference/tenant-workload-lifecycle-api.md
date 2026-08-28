---
doc_class: technical
audience: developer, operator, architect
publication: github
lifecycle: as-built
---

# Tenant workload lifecycle API

Summary: Workload-only contracts for a cloud control plane to inspect a shard,
provision tenants, change lifecycle state, and reconcile cloud-managed routing
aliases without acquiring an interactive EnterpriseGlue session.

Audience: Developers, operators, architects, and security reviewers.

## Authentication boundary

Create a service account with only the `tenant:lifecycle` scope. Every route in
this document requires its `egsa_...` bearer token. User access tokens, browser
cookies, API-client tokens, plugin invocation tokens, and tenant placement
assertions are not accepted as workload identity.

The workload API never returns access or refresh tokens and never creates an
interactive user, tenant, or browser session. Store the reveal-once service
account token in the deployment's workload-secret boundary and rotate or
revoke it with the existing service-account administration contract.

## Required mutation headers

Every mutation requires:

```http
Authorization: Bearer egsa_<account>_<secret>
Idempotency-Key: <stable 16-200 character operation key>
X-Correlation-ID: <safe 8-160 character trace identifier>
Content-Type: application/json
```

The ledger stores SHA-256 hashes of the idempotency key and canonical request,
not the raw key. An identical retry by the same service account and command
returns the original receipt with `idempotent: true`. A different request under
that key returns `409 Conflict`. Tenant mutations and the receipt ledger commit
in one database transaction.

## Shard readiness

`GET /api/workloads/tenancy/capabilities` returns the authenticated shard ID,
supported placement assertion versions, whether placement v2 is required,
database isolation mode, and the workload receipt algorithm, key ID, and
issuer. It exposes no private key, tenant record, registry credential, or
commercial data.

The unauthenticated `GET /api/tenancy/capabilities` remains available for the
browser, but omits shard and receipt identity.

The authenticated response also reports tenant-secret broker availability and
whether workload-only secret-reference recovery is enabled. It never exposes a
broker token, secret-manager identifier, or secret value.

## Provision a tenant

`POST /api/workloads/tenants`

```json
{
  "name": "Alpha Industries",
  "slug": "alpha",
  "placementKey": "regional-shard-03",
  "ownerUserId": null
}
```

`placementKey` defaults to the configured shard ID and must match it when the
shard ID is configured. `ownerUserId` is optional so a control plane may create
the tenant before its independent SSO provider and administrator mapping are
activated. Supplying it preserves the established initial-administrator
behavior and requires an existing active user.

The first successful request returns `201`; an identical retry returns `200`.
Both return the same signed receipt.

## Suspend or resume

```http
POST /api/workloads/tenants/<tenant-id>/suspend
POST /api/workloads/tenants/<tenant-id>/resume
```

```json
{
  "expectedPlacementEpoch": 7
}
```

The optimistic epoch prevents a stale control-plane operation from changing a
tenant that has moved. Suspending the protected default tenant remains
forbidden. A suspended tenant cannot establish tenant request context or issue
new tenant sessions.

## Reconcile routing aliases

`PUT /api/workloads/tenants/<tenant-id>/routing-aliases`

```json
{
  "aliases": ["alpha.enterpriseglue.example"],
  "expectedPlacementEpoch": 7
}
```

The request is an authoritative replacement of only the cloud-managed alias
registry for that tenant. It does not modify tenant-admin custom-domain or
work-email discovery records. Every alias must be a valid FQDN and cannot be
owned by another tenant in either routing registry. A changed alias set
increments the placement epoch; an unchanged set does not.

## Recover an identity-provider secret reference

`POST /api/workloads/tenants/<tenant-id>/identity-provider-secret-reference`

This route is disabled unless `EG_TENANT_SECRET_BREAK_GLASS_ENABLED=true`. It
does not accept secret material. It replaces one provider field with an
already-available environment, file, Docker, or bare environment reference.
Broker references are rejected so the recovery path stays independent of a
broker outage.

```json
{
  "providerKey": "alpha-oidc",
  "purpose": "oidc.client_secret",
  "reference": "ref:env://EG_ALPHA_OIDC_CLIENT_SECRET",
  "expectedPlacementEpoch": 7,
  "enableProvider": false,
  "confirmation": "SET_TENANT_SECRET_BREAK_GLASS_REFERENCE"
}
```

The tenant and provider lookup is exact and cannot fall back to platform or
another tenant. The reference must resolve before the provider is changed.
Keep `enableProvider` false for a staged recovery; setting it true enables the
provider in the same database transaction. The signed receipt command is
`set_secret_reference_break_glass`. An independent audit record contains the
tenant, provider, purpose, actor, operation, and correlation identifiers but
not the reference contents or secret material.

## Signed receipt

The response wraps a `tenant-workload-receipt.enterpriseglue.io/v1` payload and
an ES256 signature:

```json
{
  "payload": {
    "schemaVersion": "tenant-workload-receipt.enterpriseglue.io/v1",
    "issuer": "enterpriseglue-shard-03",
    "audience": "enterpriseglue-control-plane",
    "operationId": "01...",
    "command": "reconcile_aliases",
    "actorId": "01...",
    "tenantId": "01...",
    "tenantSlug": "alpha",
    "tenantStatus": "active",
    "placementEpoch": 8,
    "routingAliases": ["alpha.enterpriseglue.example"],
    "correlationId": "operation-1842",
    "requestHash": "<sha256>",
    "idempotencyKeyHash": "<sha256>",
    "issuedAt": 1800000000
  },
  "signature": {
    "algorithm": "ES256",
    "keyId": "shard-receipt-2026-08",
    "value": "<base64url IEEE-P1363 signature>"
  },
  "idempotent": false
}
```

Verify the signature over recursively key-sorted canonical JSON of `payload`
using the P-256 public key selected by `keyId`. The control plane must also
verify issuer, audience, command, tenant, correlation ID, and request hash
before accepting the receipt.

## Compatibility and rollback

- `single` remains the default and the workload mutation routes return a
  conflict outside pooled mode.
- Existing platform-user tenant routes and placement v1 remain supported.
- The lifecycle ledger and routing-alias tables are additive.
- Disable `EG_TENANCY_CLOUD_REQUIRED` and stop calling the workload routes
  before rolling the application back. Keep additive tables through the
  application rollback window.
- Replace broker-backed provider references with verified local references
  before rolling back tenant-secret support, and keep the broker available
  until no persisted provider depends on it.
