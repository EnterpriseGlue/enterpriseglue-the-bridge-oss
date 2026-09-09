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

Create a service account with only the `tenant:lifecycle` scope. Lifecycle routes
require its `egsa_...` bearer token; the release-assignment controller routes
below instead require the dedicated controller credential. User access tokens, browser
cookies, API-client tokens, plugin invocation tokens, and tenant placement
assertions are not accepted as workload identity.

The workload API never returns access or refresh tokens and never creates an
interactive user, tenant, or browser session. Store the reveal-once service
account token in the deployment's workload-secret boundary and rotate or
revoke it with the existing service-account administration contract.

## Required mutation headers

Lifecycle mutations require:

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

For a managed mixed-release shard it additionally reports the configured host
release. Such a shard accepts only placement v3 assertions for that exact
release.

## Hand off tenant-owned asynchronous work

`PUT /api/workloads/tenants/<tenant-id>/release-assignment` is a separate
private controller contract. It deliberately does not accept the ordinary
`tenant:lifecycle` service-account credential; it requires the dedicated
`EG_TENANT_RELEASE_CONTROLLER_TOKEN` bearer.

```json
{
  "releaseId": "saas-2026-09",
  "assignmentEpoch": 12
}
```

Only the host whose configured `EG_TENANT_PLACEMENT_RELEASE_ID` exactly matches
`releaseId` may accept the assignment. The operation is transactional and
monotonic: it updates queued plugin events and schedules to the new release and
epoch, returns the same result for an identical retry, rejects stale epochs,
and blocks while delivery is in flight. The Cloud controller must complete
this handoff before exposing the new assignment to edge routing. Rotate the
controller token across all concurrently supported host releases as one
coordinated secret operation; never put it in browser configuration or logs.

### Conditional activation (v2)

Controllers that need a current tenant-state proof must also send
`expectedPlacementEpoch`, obtained from the tenant lifecycle receipt:

```json
{
  "releaseId": "saas-2026-09",
  "assignmentEpoch": 12,
  "expectedPlacementEpoch": 7
}
```

The successful response uses
`schemaVersion: "tenant-release-work-assignment.enterpriseglue.io/v2"` and
includes `tenantStatus: "active"` and `placementEpoch: 7`, alongside the existing
tenant, release, assignment epoch, update counts, and idempotency fields.
The transaction first conditionally writes the existing Tenant row without
changing its epoch or timestamp. It requires exactly one matching active tenant
at the expected placement epoch before locking or modifying assignments and
queued work. Missing, suspended, deleting, or moved tenants fail with `409`,
including on an otherwise identical assignment replay. Lifecycle writes to the
Tenant row serialize with this fence; serialization failures remain failures
and must not be interpreted as successful activation.

This uses TypeORM conditional DML rather than database-specific locking SQL.
MySQL must retain its driver's default `FOUND_ROWS` behavior; an overridden
affected-row mode or an unavailable affected-row count fails closed. No schema
migration is required. Transaction lock order is Tenant, assignment, then work;
future lifecycle changes must not acquire these locks in reverse order.
Oracle assignment locking uses an unbounded unique-key query because Oracle
does not allow `FOR UPDATE` on TypeORM's row-limited `findOne` view.

Requests without the precondition retain the exact v1 response and legacy
semantics; they do **not** prove tenant existence or activity. Older hosts reject
the new field because request validation is strict. Conditional clients must
nevertheless require v2, active status, and matching tenant, release, assignment
and placement epochs; never silently fall back to v1 or treat a stripped field
as successful negotiation. Downgrading a host leaves conditional clients
fail-closed until a compatible host is restored.

The v2 response proves the transaction's snapshot, not future availability.
A subsequent suspension, deletion, or placement change can invalidate it;
normal host request-time placement/status enforcement remains mandatory. An
old signed creation receipt alone is not a current-state proof, and resume must
not be used merely to obtain a newer receipt.

### Durable activation operation receipts

`POST /api/workloads/tenants/<tenant-id>/release-assignment-operations` is an
additive pooled-mode controller endpoint. Use the same dedicated release-controller
bearer as assignment v1/v2, an immutable `Idempotency-Key` (16–200 printable
non-whitespace ASCII characters) and `X-Correlation-ID` (8–160 characters, letters,
digits, dot, underscore, colon or hyphen, starting with a letter or digit).
Query parameters and unknown body fields are rejected. Example body:

```json
{"releaseId":"saas-2026-09","assignmentEpoch":12,"expectedPlacementEpoch":7}
```

Both epochs are required positive safe JSON integers. The signed
`tenant-release-activation-receipt.enterpriseglue.io/v1` payload binds the
fixed authenticated actor `tenant-release-controller`, operation ID, issuer,
audience, tenant, release, assignment/placement epochs, original correlation ID,
canonical request hash, idempotency-key hash and issue time. It uses the existing
workload ES256 signing configuration and has no mutable `idempotent` flag.

One transaction reserves the unique operation, checks the active tenant and
placement, assigns queued work, signs and stores the receipt, then commits.
Signing or persistence failure rolls back all those changes. The operation
ledger's command namespace is broader than the unchanged lifecycle v1 API.
The new `assign_release` command is not accepted by lifecycle v1 receipts.

An exact retry returns the original signed envelope before changing Tenant,
assignment, event or schedule rows. A changed tenant, release, epoch or correlation
under the same key fails with HTTP 409. A concurrent loser or lost commit acknowledgement
can resolve only by reading the exact completed receipt, never by assuming a
duplicate database error means success or blindly retrying the mutation. A pending
operation is not taken over by age. Retain completed ledger records permanently
until a separately reviewed duplicate-fencing replacement exists.

This is historical transaction completion, not a current-state snapshot. Replay
after subsequent suspension or release movement still returns that original
receipt without undoing the later change. Consumers must verify its signature,
trusted issuer/audience/key and exact original request binding, retain historical
verification keys, and separately check current placement/readiness. It proves
neither original worker termination nor plugin/global work quiescence. Existing
v1/v2 routes and their snapshot semantics are unchanged. Before rollback, disable
the new consumer; preserve ledger records and verification keys.

For current release-wide work admission and settlement, use the separate
[managed release effect settlement runbook](../runbooks/release-effect-settlement.md).
Its current inventory is intentionally incomplete; an activation receipt never
substitutes for `eligibleForShutdown=true` from a complete settlement cohort.

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
- The release-work assignment table and nullable release fields are additive;
  unmanaged schedules/events continue to use their established rows when no
  managed release ID is configured.
- Disable `EG_TENANCY_CLOUD_REQUIRED` and stop calling the workload routes
  before rolling the application back. Keep additive tables through the
  application rollback window.
- Replace broker-backed provider references with verified local references
  before rolling back tenant-secret support, and keep the broker available
  until no persisted provider depends on it.
