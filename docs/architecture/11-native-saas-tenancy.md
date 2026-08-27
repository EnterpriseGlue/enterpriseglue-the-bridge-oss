---
doc_class: technical
audience: architect, developer, operator
publication: github
lifecycle: as-built
---

# Native SaaS Tenancy

Summary: Technical architecture and operating contract for EnterpriseGlue OSS
single-tenant and pooled-tenancy modes.

Audience: Architects, developers, security reviewers, and operators.

## Scope

EnterpriseGlue OSS has one native tenancy kernel with two explicit modes:

- `single` is the backward-compatible default. The deployment has exactly one
  canonical tenant, `default`, and retains the established root API aliases.
- `pooled` lets one PostgreSQL deployment host multiple real tenants. Every
  ordinary request, session, identity provider, authorization decision, data
  query, background workload, and plugin operation must carry a verified
  tenant.

The supported SaaS ownership model is one customer organization to one
EnterpriseGlue tenant. A person may be a member of more than one tenant and
can exchange an authenticated session when switching tenants. Creating a
second tenant does not create a sub-organization inside an existing tenant.

The OSS host owns the security boundary. A private SaaS control plane may own
fleet placement, metering, subscriptions, certificates, and tenant movement,
but it cannot authorize a user or replace in-request tenant resolution.

The production Kubernetes profile separates `api` and `worker` runtime roles.
Both use verify-only database startup after a dedicated migration and preflight
sequence, so normal application identities do not need schema authority. The
default `all` runtime role and `apply` database startup retain the established
single-process self-hosted contract.

## Authority flow

The host resolves a tenant before tenant-owned data or authentication
configuration is loaded.

1. A canonical `/t/:tenantSlug/...` route is authoritative when the slug maps
   to an active tenant.
2. A verified custom hostname, or `<slug>.<EG_TENANT_BASE_DOMAIN>`, can resolve
   the same tenant.
3. An internal request may present a signed placement assertion. The tenant
   id, slug, placement key, and placement epoch must all match the durable
   tenant record.
4. An unsigned tenant header is never authoritative.
5. In `single` mode only `/t/default/...` is valid. An arbitrary slug is not
   silently rewritten to the default tenant.

The resulting request context is also installed in asynchronous local storage
so persistence and plugin code consume the same canonical tenant.

## Signed placement assertions

### Placement v1 compatibility

The private control plane and an OSS shard use this narrow contract:

- `X-EG-Tenant-Placement`: base64url-encoded UTF-8 JSON;
- `X-EG-Tenant-Placement-Signature`: base64url HMAC-SHA256 of the encoded
  placement value using `EG_TENANT_PLACEMENT_KEY`.

The JSON object is:

```json
{
  "tenantId": "01...",
  "tenantSlug": "acme",
  "placementKey": "regional-shard-03",
  "epoch": 4,
  "expiresAt": 1780000000000
}
```

`expiresAt` is a Unix epoch in milliseconds. Assertions that are expired, too
far in the future, incorrectly signed, or inconsistent with durable placement
state fail closed. Rotating a tenant's placement key increments its placement
epoch, invalidating assertions issued for the old placement.

### Placement v2 cloud trust

Placement v2 is additive and uses `X-EG-Tenant-Placement-V2` with a compact
ES256 JWS. The shard stores public JWKS material only. Its protected header
contains `alg=ES256`, `typ=JWT`, and a unique `kid`. The payload binds:

- schema `placement-assertion.enterpriseglue.io/v2`, issuer, and audience;
- subject, tenant ID, tenant slug, shard ID, and durable placement epoch;
- canonical request hostname and either `/t/<slug>` or `/api/t/<slug>` path
  prefix;
- a safe correlation ID; and
- `iat`, `nbf`, and `exp` in Unix seconds within the configured maximum age.

The verifier rejects unknown or duplicate keys, private JWK material, wrong
issuer/audience/shard, stale epochs, altered host or path, invalid validity
windows, and requests that mix v1 and v2 headers. Key rotation publishes the
new public key before use, retains the previous public key only for the bounded
overlap, and removes it after all assertions it signed have expired.

The assertion proves that the routing tier sent the request to the expected
shard. It does not prove tenant membership and does not bypass session or FGA
authorization.

## Tenant lifecycle and membership

The `tenants` table is the lifecycle and placement authority. It records the
tenant slug, active state, placement key, and optimistic placement epoch.
Tenant-admin custom domains are recorded separately and become authoritative
only after DNS verification. Cloud-managed routing aliases have their own
registry and are reconciled only by a `tenant:lifecycle` service account with
an optimistic placement epoch. Work-email discovery domains are a different,
non-authoritative directory hint and cannot route an ordinary tenant request.

Cloud tenant create, suspend, resume, and routing-alias reconciliation use
workload-only APIs. Every mutation requires a stable `Idempotency-Key` and
`X-Correlation-ID`. The durable ledger stores only hashes, binds retries to the
exact canonical request, and returns the original receipt for an identical
retry. A changed request under the same key fails. Receipts are canonical-JSON
payloads signed with a shard P-256 key and include no user session or secret.

Membership does not introduce a second authorization model. It uses the
existing FGA role assignments at tenant scope:

- native tenant administrator maps to the tenant administrator system role;
- an ordinary tenant member maps to the native viewer role;
- platform administrators remain a distinct break-glass/platform authority;
- removal of the last tenant administrator is rejected.

SSO-created membership records use source `sso` and the provider id as their
source reference. Manual administration remains distinguishable in audit and
reconciliation data.

## Tenant-bound authentication

In pooled mode authentication is tenant-first:

- password login uses `/api/t/:tenantSlug/auth/login`;
- login-method and provider discovery occurs only after tenant resolution;
- OAuth state or SAML RelayState carries signed tenant and provider context;
- provider callbacks remain global so an identity provider needs only one
  stable callback URL per shard;
- access tokens, refresh tokens, and onboarding tokens carry the tenant id and
  slug;
- refresh verifies that the tenant is active and the membership still exists;
- a token for one tenant is rejected on another tenant's route; and
- switching tenants issues a new tenant-bound access and refresh session.

The pooled root password-login, provider-discovery, and tenant API shapes work
only when the request host itself resolves to a verified tenant hostname. They
return no tenant information on the platform host, preventing the login
surface from becoming a tenant-enumeration endpoint. Canonical `/t/{slug}`
routes remain available, and single mode retains its root compatibility
aliases.

## Neutral organization discovery

In pooled mode the platform `/login` page is an organization finder; it does
not call the ambiguous root login-method endpoint. It offers two inputs:

- a work email, which is normalized to an exact DNS domain and matched only
  against active, verified organization-discovery mappings; and
- a canonical organization slug, which navigates to `/t/{slug}/login` and lets
  the ordinary tenant resolver decide whether the tenant exists and is active.

One verified active domain match returns only its canonical tenant login path.
It creates no session, identity, or membership. Zero and multiple matches use
the same public response. When the normalized email belongs to an active shard
user with memberships, the service can send an opaque 15-minute organization
link. The database stores only its SHA-256 hash, user id, expiry, and
consumption time. Exchange is atomic and single-use and returns only active
memberships; the user must still complete the selected tenant's normal login.
Account lookup and delivery run outside the public response path so ordinary
request latency does not disclose account existence. The link carries its
token in the URL fragment, which is not sent in the HTTP request, and the SPA
removes the fragment before token exchange. Reissuing a link atomically
replaces the one challenge row for that user.

Routing hostnames, tenant discovery domains, and provider `loginDomains` are
separate contracts. Provider domains narrow the login methods of an already
resolved tenant. Discovery domains suggest a tenant but never authorize it.
Public consumer-email domains are rejected for organization discovery.

`tenant_discovery_domains` is shard directory metadata: the public resolver
can read only verified domain-to-active-tenant projections, while tenant-admin
mutation routes always filter by the resolved tenant id. It is not ordinary
tenant content and is not exposed through a cross-tenant listing API.
`tenant_discovery_challenges` is transient platform-auth metadata rather than
tenant-owned business data. These two tables therefore do not use the
ordinary tenant RLS predicate, which would make pre-authentication lookup
impossible; access is confined to the native discovery services and scoped
administration routes.

## Separate SSO for every tenant

Each tenant administrator can independently manage that tenant's OIDC, SAML,
or LDAP providers and login policy. Provider records, external identities,
entitlement mappings, synchronization data, and secret references retain their
tenant id.

For example, tenants sharing one shard can simultaneously use:

- Microsoft Entra ID or another OpenID Connect provider;
- a SAML 2.0 identity provider; and
- an LDAP or Active Directory directory.

Provider keys need be unique only within a tenant. The user interface and
query caches include the route tenant so data from a previously visited tenant
cannot be reused for another one. Backend tenant-admin authorization remains
authoritative; the UI permission state is not a security control.

SSO callbacks use the established global endpoints:

- OIDC: `/api/auth/identity/callback`
- OIDC back-channel logout:
  `/api/auth/providers/{providerId}/oidc/backchannel-logout`
- SAML ACS: `/api/auth/providers/saml/callback`
- SAML logout: `/api/auth/identity/{providerKey}/saml/logout`

All provider endpoints are still subject to the production identity-provider
allowlist and secret-reference controls.

Tenant administrators may submit OIDC, SAML, and LDAP secret material through
write-only tenant routes. EnterpriseGlue stores only a reference bound to that
tenant and the specific protocol purpose. Protocol consumers validate the
binding before resolving the value through the cloud-neutral broker. Existing
encrypted, environment, file, and Docker references remain supported. See
[Tenant Secret Broker](../reference/tenant-secret-broker.md).

## PostgreSQL data isolation

Pooled mode is intentionally limited to PostgreSQL. Startup fails when pooled
mode is combined with another database or when
`EG_TENANT_RLS_ENFORCED=true` is absent.

Migrations enable and force PostgreSQL row-level security for the declared
tenant-owned table allowlist. The application installs the current tenant on
the same query runner immediately before each TypeORM query and clears it
after success or failure. The row policy permits:

- portable access in `single` mode; or
- only rows whose `tenant_id` exactly equals the request context in `pooled`
  mode.

Migration startup verifies that every expected table has forced RLS and a
policy. Pooled startup aborts if that verification is incomplete or if the
database application role is a superuser or has `BYPASSRLS`. The application
role should not own the protected tables in production; `FORCE ROW LEVEL
SECURITY` remains enabled as defense in depth.

RLS complements, rather than replaces, FGA checks. Platform-global catalogs
and tenant membership assignments remain outside the row policy where they
must be queried to resolve and authorize the tenant itself.

Refresh tokens and invitations also remain outside the ordinary tenant-content
RLS predicate because lookup by their opaque, hashed pre-authentication token
is what establishes the session tenant. Both records carry an explicit tenant
binding; refresh, invitation verification, onboarding, and redemption verify
that binding before issuing a tenant-scoped session.

## Tenant-aware background and plugin work

Native plugin control, events, schedules, storage, and the host capability
broker already require a `tenantRef`. The native resolver supplies that
context; plugins do not receive the host database or raw tenant secrets and
cannot replace the resolver or authentication middleware.

Every newly introduced queue message, cache key, scheduled job, event,
idempotency key, or lock must include the canonical tenant id. Workers must
activate the same tenant database context before accessing tenant-owned data.
Code review and two-tenant adversarial tests should reject any background path
that cannot identify its tenant before loading work.

## Native HTTP contracts

| Contract | Authority | Purpose |
| --- | --- | --- |
| `GET /api/tenancy/capabilities` | Public, non-enumerating | Report mode and supported routing/isolation capabilities. |
| `POST /api/auth/tenant-discovery` | Public, rate limited | Resolve one verified work-email domain or return the common email-link fallback. |
| `POST /api/auth/tenant-discovery/exchange` | Opaque single-use email token | List only the linked user's active memberships without creating a session. |
| `GET /api/auth/my-tenants` | Authenticated user | List only the caller's memberships. |
| `POST /api/auth/switch-tenant` | Authenticated member | Exchange the session for another active tenant membership. |
| `GET/POST /api/platform/tenants` | Platform administrator | List or create one organization/tenant. |
| `PATCH /api/platform/tenants/:tenantId` | Platform administrator | Change lifecycle or placement with an epoch check. |
| `/api/t/:tenantSlug/tenant/members` | Tenant administrator | List, grant, or remove tenant membership. |
| `/api/t/:tenantSlug/tenant/login-policy` | Tenant administrator | Read or update local-password and provider-selection policy. |
| `/api/t/:tenantSlug/tenant/domains` | Tenant administrator | Create and verify a custom hostname. |
| `/api/t/:tenantSlug/tenant/discovery-domains` | Tenant administrator | Create, DNS-verify, list, or disable work-email discovery domains. |
| `/api/t/:tenantSlug/identity/providers` | Tenant administrator | Manage that tenant's OIDC, SAML, and LDAP providers. |

Tenant creation requires an owner user and immediately grants that user the
tenant administrator role. The default tenant cannot be suspended or deleted.

### Control ownership in the first pooled OSS slice

Native tenancy does not make every platform-level automation contract tenant
aware. Use the following ownership boundaries rather than assuming that a
root-shaped endpoint or configuration bundle selects the current tenant:

| Resource | Portal | REST | `v1beta1` configuration bundle |
| --- | --- | --- | --- |
| Tenancy mode, base domain, placement key, RLS enforcement | No | No | No; deployment environment only |
| Tenant creation and navigation | **Tenants** page | Platform tenant APIs | Not supported |
| Tenant lifecycle and placement updates | View/open only | Platform tenant APIs | Not supported |
| Direct tenant membership | **Tenant settings** | Tenant membership APIs | Not supported; bundle groups and assignments are separate authorization objects |
| Tenant login policy | **Tenant sign-in and identity** | Tenant login-policy API | Not supported for non-default pooled tenants; the existing top-level `login` block remains a single/default-scope compatibility contract |
| Tenant OIDC, SAML, or LDAP providers | **Tenant sign-in and identity** | Tenant identity-provider APIs | Not supported for non-default pooled tenants in this slice; use the tenant portal or REST API |
| Work-email discovery domains | **Tenant sign-in and identity** | Tenant discovery-domain APIs | Not supported |
| Custom routing hostnames | No | Tenant custom-domain APIs | Not supported; certificate and external DNS automation remain control-plane responsibilities |

Configuration-bundle preview, diff, apply, and export remain platform-admin
contracts whose OSS compatibility scope is the canonical default tenant. A
`tenantKey`, raw tenant id, or tenant-shaped assignment inside a bundle must
not be used to create a tenant, select a pooled request tenant, configure a
non-default tenant's login policy, or move a tenant between placements.

## Custom-domain verification

Creating a custom hostname returns a one-time verification token. The tenant
must publish:

```text
_enterpriseglue.<hostname> TXT enterpriseglue-verification=<token>
```

Only a matching DNS record moves the alias to `verified`. Certificate issuance
and renewal are control-plane responsibilities; DNS verification alone does
not provision TLS.

## Organization-discovery domain verification

Creating a work-email discovery domain returns a separate one-time token. The
tenant must publish:

```text
_enterpriseglue-discovery.<email-domain> TXT enterpriseglue-discovery-verification=<token>
```

The token is stored only as a hash and cleared after successful verification.
Multiple tenants may prove the same controlled domain; that condition never
auto-selects a tenant and instead uses the common email-link or
organization-name fallback.

## Configuration

| Variable | Default | Contract |
| --- | --- | --- |
| `EG_TENANCY_MODE` | `single` | `single` or `pooled`. |
| `EG_TENANT_BASE_DOMAIN` | unset | Optional managed suffix for `<slug>.<base-domain>`. |
| `EG_TENANT_PLACEMENT_KEY` | unset | HMAC key of at least 32 characters for placement v1 compatibility. |
| `EG_TENANT_PLACEMENT_MAX_AGE_SECONDS` | `120` | Maximum accepted assertion lifetime, up to 3600 seconds. |
| `EG_TENANT_PLACEMENT_V2_JWKS_JSON` | unset | Public ES256 JWKS with unique `kid` values. |
| `EG_TENANT_PLACEMENT_V2_ISSUER` | unset | Exact trusted issuer. |
| `EG_TENANT_PLACEMENT_V2_AUDIENCE` | unset | Exact shard and receipt audience. |
| `EG_TENANT_PLACEMENT_V2_SHARD_ID` | unset | Canonical shard identity. |
| `EG_TENANT_PLACEMENT_V2_CLOCK_SKEW_SECONDS` | `5` | Bounded clock tolerance, maximum 60 seconds. |
| `EG_TENANCY_CLOUD_REQUIRED` | `false` | Fail startup unless placement v2, signed receipts, forced RLS, tenant secret broker, and signed tenant application eligibility settings are complete. |
| `EG_TENANT_APP_ELIGIBILITY_REQUIRED` | `false` | Require a complete signed tenant application eligibility verifier; cloud-required mode requires `true`. |
| `EG_TENANT_APP_ELIGIBILITY_JWKS_JSON` | unset | Public P-256 ES256 keys trusted for tenant/plugin eligibility projections. |
| `EG_TENANT_APP_ELIGIBILITY_ISSUER` | unset | Exact trusted eligibility issuer. |
| `EG_TENANT_APP_ELIGIBILITY_AUDIENCE` | unset | Exact shard audience for eligibility projections. |
| `EG_TENANT_WORKLOAD_RECEIPT_PRIVATE_KEY` | unset | Shard-only PEM P-256 receipt signing key. |
| `EG_TENANT_WORKLOAD_RECEIPT_KEY_ID` | unset | Receipt signing key identifier. |
| `EG_TENANT_WORKLOAD_RECEIPT_ISSUER` | unset | Stable receipt issuer. |
| `EG_TENANT_RLS_ENFORCED` | `false` | Must be `true` before pooled mode starts. |
| `EG_TENANT_SECRET_BROKER_URL` | unset | Private cloud-neutral broker base URL. |
| `EG_TENANT_SECRET_BROKER_TOKEN_REF` | unset | Local-provider reference for broker workload authentication. |
| `EG_TENANT_SECRET_BROKER_TIMEOUT_MS` | `5000` | Bounded request timeout in milliseconds. |
| `EG_TENANT_SECRET_BROKER_CACHE_TTL_MS` | `15000` | Per-process resolved-value TTL; maximum 60000. |
| `EG_TENANT_SECRET_BROKER_CACHE_MAX_ENTRIES` | `256` | Per-process resolved-value cache bound; maximum 1024. |
| `EG_TENANT_SECRET_BROKER_REQUIRED` | `false` | Require URL and token reference at startup. |
| `EG_TENANT_SECRET_BREAK_GLASS_ENABLED` | `false` | Enable audited workload-only recovery to a verified local reference. |

Use a secret manager for placement v1 and workload receipt private keys. The
placement v2 JWKS is public verification material. The broker token stays in
the shard workload-secret boundary, while tenant SSO values stay behind the
tenant-bound broker contract. None of these values may appear in a
tenant-facing response or native plugin.

## Repeatable pooled end-to-end qualification

Run the native pooled browser lane from the repository root:

```bash
pnpm run test:native-tenancy:pooled-e2e
```

The runner compiles the backend and frontend from the checked-out source, then
starts a disposable local shard containing EnterpriseGlue, PostgreSQL,
Keycloak, and OpenLDAP. PostgreSQL creates a distinct application role that is
neither a superuser nor allowed to bypass RLS; the backend runs in `pooled`
mode with forced tenant RLS enabled. TLS, credentials, tenants, identity
providers, containers, and volumes are generated for that invocation and
removed afterward.

The browser journey creates three tenants in the same shard and deliberately
uses the same provider key, `tenant-sso`, for all three:

| Tenant | Provider | Journey |
| --- | --- | --- |
| Alpha | OIDC | Browser redirect, Keycloak authentication, callback, and tenant-bound session. |
| Bravo | SAML | Browser redirect, signed SAML response/POST callback, and tenant-bound session. |
| Charlie | LDAP | Tenant login page, direct LDAPS bind, and tenant-bound session. |

The lane verifies tenant-specific provider administration and connection
tests, including that an Alpha tenant administrator can inspect and test
Alpha's provider but is denied the equivalent Bravo operations. It also checks
the neutral organization finder, tenant lifecycle UI, workspace-name
navigation, tenant picker, keyboard focus, narrow-screen reflow, 200% zoom,
verified-email routing into Alpha's tenant login, tenant-isolated discovery-domain
administration, privacy-equivalent pending and unknown email results,
tenant-only pre-authentication provider discovery, denial of pooled root aliases,
denial when one tenant attempts to start another tenant's provider, real
protocol login, session tenant binding, membership visibility, sibling-tenant
route denial, and immediate rejection of an existing session after its tenant
membership is removed. It records that the application database role cannot
bypass RLS and counts the forced-policy tables.

The lane provisions OIDC, SAML, and LDAP material through a disposable private
implementation of the tenant-secret broker, proves cross-tenant reference
denial, rotates the OIDC credential, checks availability, and then completes
all three real protocol sign-ins. Sanitized diagnostics are written to
`.artifacts/pooled-tenancy-e2e/`; secrets are never copied there. Deterministic desktop screenshots are retained under
`playwright-results/ui-evidence/standard`, with narrow-screen and zoom evidence
in the adjacent `responsive` directory. Keycloak and OpenLDAP are high-fidelity
disposable protocol emulators. This lane proves the EnterpriseGlue protocol and tenant
isolation paths, but it does not replace pre-production certification against
the specific external identity providers a SaaS customer will use.

Standard CI runs this lane automatically when native tenancy, tenant SSO,
organization discovery, pooled routing, or their browser fixtures change. The
pooled result and sanitized UI evidence are uploaded as a 14-day CI artifact,
and the aggregate CI check cannot pass when this lane fails.

## Upgrade from 0.16.2

The implementation is based on OSS release `v0.16.2`. It adds these ordered
migrations:

1. `1700000000124-add-native-saas-tenancy`
2. `1700000000125-backfill-native-tenant-ownership`
3. `1700000000126-add-postgres-tenant-rls`

The five-adapter database qualification includes a populated
v0.16.2-equivalent upgrade baseline. PostgreSQL, MySQL, SQL Server, Oracle, and
Spanner must all recreate the portable tenant schema, backfill legacy tenant
ownership, tolerate a repeated migration attempt, and converge on the same
logical-schema fingerprint as a clean install. PostgreSQL additionally runs the
forced-RLS qualification described above.

Upgrade in `single` mode first. The backfill assigns legacy tenant-owned rows,
refresh tokens, and invitations to the canonical default tenant. The foundation
migration also creates verified discovery-domain and single-use discovery-token
storage; these remain inactive in single mode. Verify normal single-mode
operation before configuring pooled mode.

This release does not declare general production readiness for pooled mode.
The native kernel, database backstop, and disposable OIDC/SAML/LDAP pooled
browser qualification are implemented, but an intended SaaS deployment must
still complete inherited-data, asynchronous-work, plugin, multi-replica,
customer-provider compatibility, migration, restore, and rollback
qualification before serving customer traffic.

Before pooled activation:

1. use PostgreSQL with a non-public application schema;
2. confirm migrations and the RLS startup verification pass;
3. confirm the application database role cannot bypass row security;
4. configure the placement key and any managed base domain;
5. create tenants and their first administrators through the platform API;
6. configure each tenant's own login policy and identity provider;
7. run adversarial tests with two tenants through HTTP, direct repository
   access, session refresh/switch, SSO, jobs, and plugins; and
8. enable pooled routing only after those checks pass.

Return to `single` mode before application downgrade. Down migrations remove
the new pooled-tenancy records; preserve a pre-upgrade backup when those
records or tenant-specific SSO configuration must be retained.

## Private control-plane boundary

The OSS implementation deliberately stops at a signed data-plane contract.
The private control plane remains responsible for:

- tenant-to-shard placement policy and movement orchestration;
- billing, plans, metering, quotas, and commercial entitlements;
- regional fleet lifecycle and capacity;
- certificates and external DNS automation; and
- support workflows that require cross-shard inventory.

It should use signed, short-lived placement assertions and ordinary platform
administration APIs. It must not receive a database-wide tenant bypass for
serving end-user requests.
