---
doc_class: technical
audience: developer, operator, architect, security
publication: github
lifecycle: as-built
---

# Platform Cloud identity

Summary: Cloud-neutral host contract for exchanging a current user session and
an exact platform tenant permission for a short-lived signed assertion.

Audience: Developers, operators, architects, and security reviewers.

## Host exchange contract

`POST /api/platform/cloud-identity` accepts a strict JSON object with exactly
one of the existing authorization action identifiers:

```json
{"action":"platform.tenants.read"}
```

or:

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
| `action` | Exactly one of `platform.tenants.read` or `platform.tenants.manage`. |
| `iat`, `nbf`, `exp` | Integer seconds; `nbf` is exactly `max(0, iat - 2)` and `exp` is exactly `iat + 90`. |

No tenant record, tenant membership, SSO provider configuration, external
identity assertion, secret reference, secret value, browser cookie, access
token, or refresh token is included.

## Verifier requirements

A consumer must:

- accept only ES256 and verify the signature with a configured trusted P-256
  public key selected by `kid`, rejecting a missing or unknown key;
- require the exact schema version, configured issuer, platform-specific
  audience, and intended shard ID;
- require the `user:` subject grammar and bind the exact action to the intended
  Cloud operation, never allowing read identity to authorize management;
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
tenant administration compatibility is unchanged.

## Rollback and database portability

Disable callers before removing `EG_PLATFORM_CLOUD_IDENTITY_AUDIENCE` or
rolling back the host. Disable cloud-required mode only when restoring direct
shard-local mutation is an intentional operator decision.

Identity issuance is stateless and adds no entity or migration. The mutation
fence runs before the existing TypeORM `TenantService`, making its denial
database-independent. PostgreSQL remains the primary pooled-mode feedback lane;
the five-database candidate matrix remains required portability evidence for a
release even though this contract introduces no database DDL.
