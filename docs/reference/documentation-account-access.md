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


## Customer documentation workspaces

General `documentation:read` admission does not authorize customer content.
The optional private `EG_DOCUMENTATION_WORKSPACES_JSON` setting defines explicit
admission policy. The default is no customer workspaces. Keep real policy values
in protected deployment configuration outside source control and public logs.

The bounded policy has this shape; identifiers and domains below are fixtures:

```json
{
  "schemaVersion": 1,
  "workspaces": [
    {
      "id": "customer-a",
      "name": "Customer A",
      "active": true,
      "accessMode": "verified_domain",
      "allowedEmailDomains": ["customer-a.example.test"],
      "readers": []
    }
  ]
}
```

`accessMode: "verified_domain"` admits any current active account with a verified
email address at an allowed domain. Selecting this mode is the publisher's
explicit domain admission decision; it requires no individual reader grant.
`readers` must be empty in this mode so restrictions are never silently ignored.
When `accessMode` is absent or `"explicit_readers"`, both the exact domain and
an unexpired individual reader grant are required. `expiresAt` is an absolute
Unix timestamp in milliseconds; resolve immutable IDs through account administration.
Domains are lowercase exact matches; subdomains and suffix matches are
not included. Duplicate workspace/reader IDs, wildcards and malformed policies
fail closed. Limits are 32 workspaces, 32 domains per workspace, 500 reader grants
per workspace and 256 KiB for the complete JSON setting.

`GET /api/auth/documentation/workspaces` requires a dedicated gateway credential
and current documentation token. It returns only the active, unexpired workspaces
for the freshly verified user's actual email and the selected admission mode.
`GET /api/auth/documentation/session?workspace=customer-a` repeats those checks
and returns `workspaceId` only when that workspace is authorized. Unknown and
unauthorized workspaces both return 404. This authority is independent of tenant
membership and does not provision an application tenant. Browser access tokens,
machine credentials and caller-supplied customer headers cannot bypass the
existing documentation-token boundary.

The policy is publisher-managed deployment configuration. Verified-domain admission
uses the existing verified portal account; it neither queries AD nor creates an
AD group-provisioning integration. Individual grants remain available through
`explicit_readers` mode. Changes take effect on the
runtime instances receiving the revised configuration; drain older instances
before asserting that a grant is revoked everywhere. Individual grant expiry is evaluated
on every read without waiting for documentation-token expiry. Existing account
and exact-session revocation is checked against persistence before every read.
Upstream AD removal takes effect when the existing account/directory revocation
workflow records it locally; this endpoint does not query AD itself.

Roll out the new account contract before enabling customer bundles. Old account
responses lacking the requested `workspaceId` cannot authorize customer delivery.
Remove customer bundles before rolling back the account feature. Customer source,
compiled content and sensitive acceptance evidence belong in private authoring,
publication and artifact storage; public CI should use synthetic fixtures only.

The public configuration endpoint also returns `workspaceContract` equal to
`customer-documentation/v1`. The gateway deployment preflight requires this
capability before sending its dedicated credential. An older account runtime
cannot pass workspace rollout preflight. No workspace names, domains, readers
or policy values are exposed in this public response.
