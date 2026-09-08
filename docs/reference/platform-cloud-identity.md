---
doc_class: technical
audience: developer, operator, architect
publication: github
lifecycle: as-built
---

# Platform Cloud identity

Summary: Cloud-neutral host contract for exchanging a current user session and
an exact platform tenant permission for a short-lived signed assertion.

Audience: Developers, operators, architects, and security reviewers.

## Host exchange contract

`POST /api/platform/cloud-identity` accepts a strict JSON object with exactly
one of the supported authorization action identifiers. Managed Cloud account
onboarding uses the narrow self-create action:

```json
{"action":"platform.tenants.self_create"}
```

Operator reads use:

```json
{"action":"platform.tenants.read"}
```

Operator mutations use:

```json
{"action":"platform.tenants.manage"}
```

The host first validates the current browser or bearer session, including
account state, session revocation, email verification, and pooled-session
rules. It then evaluates the exact action through the ordinary resource-aware
authorization and policy boundary. A read grant cannot mint a manage assertion,
and a manage request does not inherit authority from an untrusted body value.
Unsupported actions and unknown fields are rejected. Successful responses set
`Cache-Control: no-store` and return:

```json
{
  "token": "<compact ES256 JWT>",
  "expiresIn": 90,
  "action": "platform.tenants.read"
}
```

The operation's `x-enterpriseglue-authz` OpenAPI extension uses
`mode: request-action`, identifies the validated body field, and publishes all three
action alternatives with their own permission, risk, audit, resolver, and UI
metadata. Consumers must select the alternative whose `value` exactly matches
the request action; they must not treat the operation as a static read action.
Typed consumers that inspect either form use `AuthzOpenApiClassification` and
`AuthzOpenApiClassificationSchema`. The existing `AuthzOpenApiExtension` type and
parser retain their static shape for compatibility.

The token is an identity assertion for a control-plane adapter. It is not an
EnterpriseGlue access token, refresh token, API-client credential, service
account token, placement assertion, or tenant membership credential.

## Signed claims

The JWT header is `{alg: ES256, typ: JWT, kid}`. The payload follows the public
`PlatformCloudIdentityClaims` OpenAPI schema:

| Claim | Contract |
| --- | --- |
| `schemaVersion` | Exact value `platform-cloud-identity.enterpriseglue.io/v1`. |
| `iss` | `EG_TENANT_WORKLOAD_RECEIPT_ISSUER`. |
| `aud` | Exact `EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE`. |
| `sub` | Authenticated user ID prefixed with `user:`. |
| `jti` | Unique `pci_` assertion identifier. |
| `shardId` | Exact `EG_TENANT_PLACEMENT_V2_SHARD_ID`. |
| `action` | Exactly one of `platform.tenants.self_create`, `platform.tenants.read`, or `platform.tenants.manage`. |
| `iat`, `nbf`, `exp` | Integer seconds; `nbf` is exactly `max(0, iat - 2)` and `exp` is exactly `iat + 90`. |

No tenant record, tenant membership, SSO provider configuration, external
identity assertion, secret reference, secret value, browser cookie, access
token, or refresh token is included.

`EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE` is optional at host startup so a managed
deployment can roll out the host and Cloud configuration in either order. The
exchange fails closed with HTTP 503 until the audience is configured; a Cloud
consumer must not call it before deploying that configuration.

## Tenant-neutral account bootstrap

Configured global OIDC/SAML entry in managed pooled mode issues a distinct
browser session with signed `sessionClass: cloud_account`. This is separate
from the platform identity assertion above. Its class is also bound to the
persisted refresh-session metadata. It has no tenant or administrator-recovery
claim and requires an active, email-verified user and an enabled managed-account
configuration. Existing tenant and recovery session formats remain valid.

Only account bootstrap routes opt into this session class: current-user lookup,
the restricted own-permission snapshot, own memberships, verified tenant switch,
logout, and the platform exchange for `platform.tenants.self_create` only.
Refresh preserves the restricted class and checks revocation. Ordinary tenant
and application routes retain their existing authentication middleware and
reject this class. An existing operator's grants cannot turn it into a
tenant-read or tenant-management assertion.

After provisioning, tenant switching independently checks active membership,
validates the exact source access/refresh-session lineage, and issues an ordinary
tenant-bound session. The frontend can resume a registered self-create extension
from the root page for an eligible account without memberships. The Cloud
extension owns that route and its provisioning UI; OSS does not provision the
organization from the browser.

## Verifier requirements

A consumer must:

- accept only ES256 and verify the signature with a configured trusted P-256
  public key selected by `kid`, rejecting a missing or unknown key;
- require the exact schema version, configured issuer, platform-specific
  audience, and intended shard ID;
- require the `user:` subject grammar and bind the exact action to the intended
  Cloud operation, never allowing self-create or read identity to authorize
  operator management;
- require integer `iat`, exact `nbf = max(0, iat - 2)`, and exact
  `exp = iat + 90`, then enforce not-before and expiry at verification time;
- reject unknown claims and replay-fence each `jti` for the assertion lifetime;
  and
- reject this assertion at tenant-scoped and host-session endpoints.

The OSS host reuses its configured workload receipt P-256 signing identity but
uses a distinct schema and audience. The audience must differ from both the
workload receipt issuer and tenant identity audience. Private keys remain
host-only. Public-key distribution, Cloud session establishment, vendor IAM,
and Cloud API routes are deployment-owned adapter concerns and do not belong in
OSS.

## Cloud-required mutation fence

When `EG_TENANCY_CLOUD_REQUIRED=true`, authenticated
`GET /api/platform/tenants` remains readable, and the Cloud identity exchange
remains available. Direct user-session mutations through
`POST /api/platform/tenants` and `PATCH /api/platform/tenants/{tenantId}` fail
with HTTP 503 and code `CLOUD_CONTROL_PLANE_REQUIRED` before TypeORM tenant
services execute. Workload-only, idempotent tenant lifecycle APIs retain their
existing service-account and receipt contract; they are the shard execution
boundary for an authorized control plane.

Self-hosted deployments default cloud-required mode to `false`, so their direct
tenant administration compatibility is unchanged. The
`platform.tenants.self_create` exchange is additionally hidden unless
`EG_CLOUD_ACCOUNT_IDENTITY_ENABLED=true`; this flag is valid only for pooled,
Cloud-required deployments.

## Rollback and database portability

Disable callers before removing `EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE` or
rolling back the host. Disable cloud-required mode only when restoring direct
shard-local mutation is an intentional operator decision.

Platform assertion issuance is stateless and adds no entity or migration.
Cloud-account browser sessions use the existing refresh-token entity, with the
signed session class also recorded in its device metadata. Rolling back to a
host without that class requires those accounts to sign in again; do not treat
their tokens as ordinary tenant sessions. The mutation
fence runs before the existing TypeORM `TenantService`, making its denial
database-independent. PostgreSQL remains the primary pooled-mode feedback lane;
the five-database candidate matrix remains required portability evidence for a
release even though this contract introduces no database DDL.
