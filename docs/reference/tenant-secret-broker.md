---
doc_class: technical
audience: developer, operator, architect
publication: github
lifecycle: as-built
---

# Tenant secret broker

Summary: Cloud-neutral contract for storing and resolving tenant-bound OIDC,
SAML, and LDAP secret material while EnterpriseGlue persists only opaque
references.

Audience: Developers, operators, architects, and security reviewers.

## Deployment boundary

OSS defines the broker port and an authenticated private HTTP client. It does
not depend on a cloud SDK or prescribe a secret-manager product. A SaaS
deployment implements the HTTP service next to its cloud control plane and
maps the opaque broker references to its chosen secret manager.

Keep the broker on a private network. The endpoint must use HTTPS; plain HTTP
is accepted only for a loopback development endpoint. Its bearer token is
loaded through the established environment, file, or Docker secret provider.
A broker token cannot itself be a tenant-secret reference.

## Reference contract

The broker returns references in this form:

```text
tenant-secret://v1/<tenant-id>/<purpose>/<opaque-id>
```

Identity-provider configuration stores the same reference with the existing
external-reference marker:

```text
ref:tenant-secret://v1/<tenant-id>/<purpose>/<opaque-id>
```

EnterpriseGlue validates the tenant and purpose in the reference before any
broker call. A request for tenant Alpha cannot resolve, inspect, rotate, or
retire a reference issued for tenant Bravo.

The allowed purposes are:

| Protocol | Purpose | Provider configuration field |
| --- | --- | --- |
| OIDC | `oidc.client_secret` | `clientSecretRef` |
| SAML | `saml.metadata_xml` | `metadataXmlRef` |
| SAML | `saml.idp_signing_certificate` | `signingCertificateRef` |
| SAML | `saml.request_signing_private_key` | `requestSigningPrivateKeyRef` |
| SAML | `saml.request_signing_certificate` | `requestSigningCertificateRef` |
| LDAP | `ldap.bind_password` | `bindPasswordRef` |
| LDAP | `ldap.tls_trust_certificate` | `tlsTrustRef` |

## Private HTTP adapter

EnterpriseGlue calls these relative endpoints with `POST`:

```text
v1/tenant-secrets:put
v1/tenant-secrets:resolve
v1/tenant-secrets:availability
v1/tenant-secrets:retire
```

Every request includes:

```http
Authorization: Bearer <broker-workload-token>
X-EnterpriseGlue-Tenant-ID: <tenant-id>
X-Correlation-ID: <correlation-id>
Content-Type: application/json
```

The JSON body repeats `tenantId`, `purpose`, and `correlationId`. `put` also
contains `value` and may contain `previousReference`; other operations contain
`reference`. The broker must authenticate the workload, compare the header and
body tenant, enforce its own tenant/purpose binding, and return JSON.

Successful response shapes are:

| Operation | JSON response |
| --- | --- |
| put | `{"reference":"tenant-secret://v1/tenant-alpha/oidc.client_secret/01...","version":"3","updatedAt":1800000000000}` |
| resolve | `{"reference":"tenant-secret://v1/tenant-alpha/oidc.client_secret/01...","value":"<secret>","version":"3"}` |
| availability | `{"available":true,"version":"3"}` |
| retire | `{"retired":true,"retiredAt":1800000001000}` |

`updatedAt` and `retiredAt` are Unix milliseconds. Availability reasons, when
present, are `not_found`, `retired`, or `provider_unavailable`. Secret values
are limited to 256 KiB and HTTP responses are bounded. Non-success, malformed,
oversized, redirected, timed-out, or tenant-inconsistent responses fail closed
as a sanitized broker error.

## Tenant administration API

The canonical tenant routes are:

```text
POST /api/t/{tenantSlug}/identity/provider-secrets
POST /api/t/{tenantSlug}/identity/provider-secrets/retire
PUT  /api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}
GET  /api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}/availability
POST /api/t/{tenantSlug}/identity/providers/{key}/secrets/{purpose}/retire
```

They require the current tenant and `tenant:sso-providers:manage`. Secret put
and rotation bodies accept the value, but responses contain only purpose,
opaque reference, version, update time, and retirement status. Values are not
returned by read APIs, exports, audit records, errors, or the administrator UI.

For a new provider, the UI provisions secrets first, inserts only returned
references into the provider request, and retires unattached references if
provider creation fails. Rotation stores the new value before switching the
provider reference. If retiring the previous version is temporarily
unavailable, the successful rotation is returned with
`previousRetired: false` so an operator can reconcile retirement without
ambiguously retrying the secret write. Explicit retirement disables the
provider before retiring its broker value.

## Resolution and outage behavior

OIDC token exchange, SAML metadata/signature operations, and LDAP bind/TLS
setup resolve broker references asynchronously with the provider tenant and
request correlation ID. Existing encrypted-local, `env://`, `file://`, Docker,
and bare environment references retain their previous behavior.

Resolved values may be cached only in process memory. The cache has a bounded
entry count and a maximum 60-second TTL, and is invalidated on put and retire.
No fallback crosses tenant or purpose boundaries. If the broker is unavailable,
operations that need a broker-managed value fail closed; providers using local
references remain independent.

## Break-glass reference recovery

`EG_TENANT_SECRET_BREAK_GLASS_ENABLED` exposes a workload-only recovery route
documented in [Tenant workload lifecycle API](tenant-workload-lifecycle-api.md).
It accepts only an already-available environment, file, Docker, or bare
environment reference. It never accepts a value or another tenant-secret
reference. The operation requires the `tenant:lifecycle` service-account
scope, explicit confirmation, idempotency and correlation headers, a matching
tenant placement epoch, and a signed receipt. It is disabled by default and
is independently audited without secret material.

## Compatibility and rollback

The broker is opt-in. `single` remains the tenancy default and existing secret
providers need no change. Before disabling or rolling back broker support,
replace every persisted tenant-secret reference with a verified local
reference and keep the broker available until the last reference has been
removed. Do not copy broker values into configuration JSON or deployment logs.

Run `pnpm run test:native-tenancy:pooled-e2e` for the disposable PostgreSQL RLS
and browser qualification. It provisions distinct broker-backed OIDC, SAML,
and LDAP credentials for three tenants, rejects a sibling-tenant reference,
rotates the OIDC credential, and completes all three protocol sign-ins.
