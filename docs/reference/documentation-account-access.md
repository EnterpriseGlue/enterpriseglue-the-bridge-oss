---
doc_class: technical
audience: developer, operator
publication: github
lifecycle: reference
---
# Documentation account access

This optional managed-Cloud integration admits documentation readers through the
existing verified user account. It does not create tenants, memberships,
placements, subscriptions or provisioning events. Documentation requests never
call `/api/platform/cloud/onboarding/organization`.

Set `EG_DOCUMENTATION_ORIGIN` to the canonical HTTPS origin and provision the
same dedicated secret as `EG_DOCUMENTATION_GATEWAY_SECRET` on the API and as
`DOCUMENTATION_GATEWAY_SECRET` on the gateway. Do not reuse `JWT_SECRET` or expose
these settings through frontend runtime configuration. Missing configuration
disables the routes. The Cloud edge must admit `/documentation/access` as an
exact neutral account shell before the gateway is enabled.

## Browser and server contract

The gateway creates a host-only HttpOnly PKCE verifier cookie and sends the
browser to `/documentation/access?state=...&challenge=...` on the account origin.
The account page preserves only a bounded, 15-minute request context across
federated redirects. Account creation uses `intent=documentation`; email proof
links carry that destination intent even when opened in another tab. With no
browser request, the page asks the reader to restart at the documentation origin
instead of falling back to organization onboarding.

`POST /api/auth/documentation/grant` requires an active verified browser account,
a current exact session, same-origin `Origin`, and `{state, challenge}`. Recovery
sessions are excluded. The response contains a callback on the configured
origin with a signed 60-second grant. Arbitrary return origins are not accepted.

`GET /api/auth/documentation/configuration` exposes only the canonical account
and documentation origins. The account entry page uses it when no pending
browser request exists. It exposes no secrets and creates no session or tenant.

`POST /api/auth/documentation/exchange` requires the dedicated gateway header
`x-enterpriseglue-documentation-key` and `{code, verifier}`. Signature, type,
audience and PKCE proof are verified before the exact session's pending grant
identifier is atomically consumed by a conditional metadata update. Only the
latest handoff for a source session can be redeemed; a replaced tab must restart.
The existing session metadata is preserved. No migration is required.

The returned token grants only `documentation:read`, has an independent signing
key domain, expires within 15 minutes and is capped by source-session expiry.
`GET /api/auth/documentation/session` takes that token as a bearer credential
plus the gateway header. It repeats the ordinary active-user, email-verification,
exact-session and membership checks. Account suspension, logout/source-session
revocation, or account session-version changes therefore deny subsequent reads.
Ordinary application and Cloud APIs reject the documentation token family.

Each exchange registers its documentation token identifier in the source row's
metadata, retaining at most four active identifiers. A fifth successful exchange
evicts the oldest. `POST /api/auth/documentation/logout` requires the dedicated
gateway header and the signed documentation bearer token. It removes only that
identifier, including when the source user has become ineligible; it does not
revoke the parent Cloud session. Concurrent metadata changes fail closed and
require a retry. Expired credentials have no remaining read authority.

The gateway must run before every asset and fail closed on API errors. Protect
HTML, images, downloads and search data equally. Never publish a second public
asset origin. Responses are private/no-store and must not log grants, tokens or
gateway credentials. Passkeys continue to authenticate at the existing account
hostname; changing that relying-party host needs a separate migration.

## Local protocol qualification

The gateway lives in the independently owned homepage repository. Qualify its
exact source together with the account routes using an owned disposable
PostgreSQL fixture:

```sh
DOCUMENTATION_GATEWAY_MODULE=/absolute/path/to/documentation-gateway/worker.js \
  bash scripts/run-native-tenancy-postgres-rls.sh --documentation-gateway
```

This gate records the gateway source digest and exercises real grant, exchange,
read, replay rejection, documentation sign-out and parent-session revocation
through HTTP with PostgreSQL. It asserts that the fixture contains only account
and refresh-session rows. Static content uses a controlled asset fixture. The
homepage publisher's separate browser gate exercises the compiled site and real
TLS/cookie/form behavior with a controlled account API. Neither gate establishes
real-provider signup, installed releases or live Cloud acceptance.
