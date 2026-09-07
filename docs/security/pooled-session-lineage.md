---
doc_class: technical
audience: developer, operator
publication: github
lifecycle: as-built
---

# Pooled identity and browser-session boundaries

This document describes implementation and upgrade constraints for operators
and maintainers. It is not evidence of deployment or external-provider acceptance.

## Account identity

Users are shared platform identities; tenant memberships do not partition the
global email uniqueness constraint. A tenant identity provider's verified email
claim and a matching tenant membership are not independent proof of control of
an existing shared user account.

In pooled mode, `allowVerifiedEmailLinking` never authorizes adopting an existing
email-matched user, including recovery after an external identity is unlinked.
The REST protocol configuration and headless bundle option remain accepted for
round-trip compatibility. Their opt-in behavior remains single-tenant-only.
An exact existing provider/subject binding remains usable; provider claims no
longer rewrite that shared user's email, profile, or authentication provider.
Claimed attributes remain in the tenant-scoped normalized identity.

Existing bindings are not retrospectively proof of account control. Before
enabling additional tenants, operators must review historical email-derived
bindings and resolve or revoke suspicious bindings using the existing authorized
identity-conflict process. Do not silently migrate them to a new trust status.
Unlinking revokes the binding's sessions; signing in with the same email is not
a pooled account-control linking mechanism. An independently verified linking
journey is still required for legitimate shared-account enrollment.

## Invitation credentials are not existing-account proof

Inviters can receive manual invitation links and one-time passwords. Possessing
these credentials must not authorize initializing a password on an established
shared account, including a passwordless SSO account.

Pooled invitation creation and password completion require the inviter's unused
pending local account: matching email and creator, active, no password, no
verified email, no previous login, revocation version zero, and no external
identity binding. Password completion conditionally consumes the exact,
unrevoked, unexpired OTP-verified invitation and initializes that pending account
in one transaction. An intervening enrollment or credential change fails the
conditional update; a competing completion cannot replace the first password.
Enrollment advances the user's revocation version, invalidating the previous
onboarding token. Single-tenant invitation compatibility remains unchanged.

The dedicated fresh-invitation SSO path uses the same account and invitation
claims after verified OIDC, SAML, or LDAP authentication. It requires the exact
invited user and matching verified email, not a global email lookup. It does not
provide independent-account-control enrollment for an established account.
Do not enable email-only adoption as a workaround. Project and engine membership services accept the
enrollment transaction manager: project collaboration rows, canonical resource
grants, tenant grants, and associated grant audit writes participate in the
credential transaction. Existing project membership updates use that manager as
well. A later enrollment failure rolls these writes back rather than leaving
resource access behind. This transaction boundary does not replace resource
authorization or tenant-visibility checks at the calling boundary.
Pooled enrollment explicitly passes the invitation tenant to resource grants;
an already sibling-owned project or engine is rejected. Tenant-scoped project
membership conditionally updates the exact project/tenant row in a transaction
before writing access, holding ownership through the later canonical assignment
read. If a concurrent ownership update wins first, enrollment fails and rolls
back; if enrollment wins, its grants retain the original tenant. Callers without
an active transaction receive one for the scoped operation. This does not
certify a resource-transfer API or cleanup of old-tenant grants after transfer.

## Fresh-invitation SSO protocol

After invitation redemption or OTP verification establishes the HttpOnly
onboarding cookie, the browser discovers permitted methods using
`GET /api/t/{tenantSlug}/auth/onboarding/login-methods`. In pooled mode the tenant policy
determines whether password setup, provider enrollment, both, or neither are
available. Single-tenant onboarding retains password-only compatibility.
Failure to load methods does not expose a password fallback; password completion
also enforces the tenant policy on the server.

The invitation page does not restore a normal user session or fetch protected
plugin inventory. Password and LDAP completion replace/reload the authenticated
tenant shell after cookies are issued, so plugin routes and permissions load
under the new session. OIDC/SAML callbacks already perform that navigation.
Do not treat onboarding cookies or cached user metadata as session authority.

The schema-tested response example is in
`backend/test/fixtures/public-api/invitation-enrollment.json`. An authenticated
onboarding browser can use this sequence:

```text
GET /api/t/alpha/auth/onboarding/login-methods
  -> providers: [{ id: "organization-oidc", protocol: "oidc", ... }]
GET /api/t/alpha/auth/onboarding/providers/organization-oidc/start
  -> IdP redirect -> existing OIDC callback -> session cookies
```

SAML uses the same dedicated start route and existing SAML callback. Direct LDAP
uses `POST /api/t/{tenantSlug}/auth/onboarding/providers/{providerId}/login` with
`{"username":"invitee@example.test","password":"<directory-password>"}`.
These endpoints require the onboarding cookie; a provider ID or email supplied
by an unauthenticated caller is not enrollment authority. Never log the cookie,
directory password, callback assertions, or raw invitation credentials.

Invitation status, OTP verification, and email redemption use
`/api/t/{tenantSlug}/invitations/{token}` and its `/verify-otp` or `/redeem`
suffixes. Password completion uses
`POST /api/t/{tenantSlug}/auth/complete-onboarding`. Resolve the routed tenant
before using invitation credentials: sibling invitations return 404, mismatched
onboarding context returns 403, and stale placement returns 401. Verified route
placement/release metadata must survive onboarding authentication. The root
`/api/invitations/...` and `/api/auth/...` forms remain compatibility endpoints;
they are not a substitute for tenant routing at a placement-aware public edge.

The server binds invitation ID, pending user/version, tenant and provider into
signed OIDC/SAML state. Raw invitation tokens are not included. Callbacks retain
OIDC state/PKCE/nonce or SAML request-cookie and assertion-replay verification;
they do not depend on the Strict onboarding cookie crossing the IdP redirect.
Ordinary login cannot opt into enrollment through request parameters.

Both the packaged frontend proxy and local TLS rehearsal proxy reserve a bounded
16 KiB upstream response-header buffer for the signed redirect and correlation
cookies (`proxy_buffer_size`, with compatible body-buffer settings). The default
Nginx page-sized header buffer can reject this response with a 502 before the
browser reaches the IdP. Equivalent ingress deployments must preserve the full
redirect and all Set-Cookie fields; do not remove state bindings to fit a proxy
limit. This setting does not enlarge browser cookie limits or certify public
cloud edge routing.

The local TLS Keycloak fixture separately sets
`QUARKUS_HTTP_LIMITS_MAX_HEADER_LIST_SIZE=16384`. Localhost ports share host
cookies, so application correlation cookies and Keycloak restart cookies can
together exceed its 8 KiB HTTP/2 header-list default and cause 431. This bounded
fixture setting keeps HTTP/2 enabled; it is not a production IdP configuration
change. Qualify actual ingress and IdP limits independently.

Provider trust fencing, invitation consumption, user initialization, canonical
external identity, normalized snapshot, mapped and baseline memberships,
resource grants, and session insertion share one transaction. Replay, changed
authority or a later failure cannot leave a partial enrollment. Password and SSO
completion compete on the same invitation/account claims. Successful enrollment
advances the user revocation version and clears the onboarding cookie.
The invitation response exposes `requiresPasswordSet` plus, in pooled mode,
`enrollmentMode` (`password`, `provider`, `choice`, or `unavailable`); clients
must discover current methods rather than treating that response as authority.

## Durable session identity

`AuthSessionService` generates a UUID before signing access and refresh JWTs.
Both carry `sessionId`, equal to the existing `RefreshToken.id` primary key.
Refresh preserves this ID. Required and optional authentication check the exact
row's user, tenant, unrevoked status, and expiry before establishing identity.
No new database column or migration is required.

`POST /api/auth/switch-tenant` requires both a current access principal and the
matching refresh cookie, as well as active membership in the target tenant.
Bearer-only calls and pre-session-ID credentials must sign in again before
switching. A new child session retains the source's signed revocation version,
authentication method, MFA/recovery assurance, and persisted provider lineage.
Request-supplied provider identifiers do not authorize derivation.

Bcrypt truncates long inputs. Multiple signed JWTs can share its input prefix;
a hash match alone cannot select a browser session or provider. Signature
verification and exact session-ID matching therefore precede the hash check.
Local logout does not guess a federated logout target for legacy credentials.

## Concurrent revocation

Provider-backed issuance and verified federated logout acquire the same
conditional provider-row update before touching session rows. Switching then
conditionally updates its exact active source and inserts the child in the same
transaction. It checks source expiry again after acquiring the source lock.
If switch wins, logout sees and revokes the committed child. If logout wins,
the source claim fails and no child is inserted. An unrelated provider session
is not revoked by a session-targeted back-channel logout.

Local logout already applies to all browser sessions for the user. It now first
commits an atomic increment of `User.authSessionVersion`, then revokes token rows.
The separate commit avoids reversing existing provider/session/user lock order.
A concurrent child cannot upgrade its source's old version, even if a bulk token
update's statement snapshot misses its row. If token cleanup subsequently fails,
logout returns an error, but the committed version still invalidates old access
and refresh credentials; operators can retry cleanup without restoring authority.

Runtime persistence uses TypeORM repositories and transactions, not
PostgreSQL-specific lock syntax. Physical PostgreSQL race tests do not establish
equivalent behavior for every supported database engine.

## Upgrade and rollback limits

- In pooled mode, pre-upgrade access and refresh tokens without `sessionId` are
  rejected. Arrange an authorized upgrade/reauthentication window: users,
  including recovery administrators, must sign in again. Optional authentication
  treats these old credentials as anonymous. A refresh cannot extend their
  lifetime or manufacture exact-row authority.
- Single-tenant deployments retain the existing legacy account-version and
  expiry checks; their legacy refreshes can still issue ID-less access tokens.
  Do not claim exact-row provider revocation for those old single-mode tokens.
- Coordinate host and shared-package upgrades. Mixed host revisions can continue
  to issue old credentials and cannot support a complete cutover claim.
- This change does not prove ordering between a brand-new IdP authentication and
  a back-channel logout for that external session; the race tests cover derived
  sessions. Provider emulator and browser qualification remain separate gates.
- Reverting application code restores email-adoption and derived-session
  revocation exposure even though the schema is unchanged. Treat rollback as a
  security decision, not only a database compatibility check.

## Regression qualification

Run `pnpm run test:native-tenancy:postgres-rls` for an owned disposable PostgreSQL
container. It combines restricted-role RLS qualification with session tests using
real TypeORM entities, JWTs, bcrypt, authentication middleware, and HTTP routes.
The race tests wait for a real PostgreSQL lock before releasing the competing
transaction; they cover both provider orderings and logout-all's source-first
ordering. The fixture database is unique to the test and is removed afterward.
It also proves pooled legacy-token denial and single-use password enrollment
under a real concurrent-completion lock. Resource enrollment cases exercise
actual project membership and canonical assignments, and actual engine/tenant
grant persistence, including rollback after an injected later failure.
Fresh-invitation cases compose OIDC/SAML/LDAP routes with real account, external
identity, normalized snapshot, baseline/mapped memberships and session writes.
They cover a failed session insertion rolling back those writes, and subsequent
provider provisioning removing missing entitlements without removing unrelated
manual or other-provider memberships. Sibling-tenant mappings are not applied.
Provider verification, tenant membership resolution, and access-authority
policy selection are controlled boundaries; these tests are not external
identity-provider certification or complete authorization qualification.

The existing protected pooled-tenancy CI job runs this gate before the separate
OIDC/SAML/LDAP browser-emulator lane. Classifier regressions ensure session,
identity-provisioning, and relevant persistence edits select that job. Hosted CI
must still verify the exact proposed revision after the integrated local gate.
