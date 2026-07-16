# Identity Test Setup

Use the grouped `test:identity:*` commands to choose the smallest relevant
test lane. The pre-existing dashed commands remain supported for CI jobs and
automation that already use them.

| Command | Boundary covered | External dependency |
| --- | --- | --- |
| `pnpm run test:identity:contract` | normalization, mapping, provider, replay, and migration services | none |
| `pnpm run test:identity:routes` | authentication and Platform Admin HTTP routes | none |
| `pnpm run test:identity:matrix` | OIDC/SAML/LDAP normalized-identity compatibility matrix | none |
| `pnpm run test:identity:protocol` | loopback OIDC and SAML transport fixtures plus mock contracts | none |
| `pnpm run test:identity:ui` | provider and mapping administration screens | none |
| `pnpm run test:identity:local` | all of the preceding local-only lanes | none |
| `pnpm run test:identity:browser` | configure, apply, login, and reconciliation browser lifecycle using the in-browser identity stack | local frontend and Playwright Chromium |
| `pnpm run test:identity:ldap` | real LDAPS bind, search, TLS, and nested-group flow | Docker |
| `pnpm run test:identity:verify` | complete local identity verification, including browser lifecycle and LDAPS | local frontend, Playwright Chromium, and Docker |

Run `test:identity:local` during ordinary development. It is fully in-process
and does not read or write a database. Add `test:identity:browser` when a
provider or mapping change affects the UI lifecycle: it disables E2E seeding,
intercepts every application API request with the browser-local identity stack,
and refuses a non-local `PLAYWRIGHT_BASE_URL`. It needs only a locally running
frontend (by default `http://localhost:5173`) and Playwright Chromium. Install
the latter once for the current workspace with:

```bash
pnpm exec playwright install chromium
```

Add `test:identity:ldap` for directory-client changes; it remains separate so
a missing Docker daemon cannot hide regressions in the local-only suite. The
broader `test:authz-refactor` lane keeps its compatibility-oriented CI scope
and includes the protocol-mock lane, but deliberately does not start Docker.
Use `test:identity:verify` when the local frontend, Playwright, and Docker are
available and a complete local identity pass is appropriate.

To point the browser lane at another local stack, set a loopback or `.local`
URL explicitly:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5174 pnpm run test:identity:browser
```

The browser command deliberately rejects public or shared URLs. Use the
cutover runbook for deployed-provider evidence; this lane is not an IdP
credential or production sign-in test.

## LDAP Protocol Test Harness

Use this opt-in harness when a change needs a real LDAP/LDAPS server boundary.
It is not part of the ordinary unit, integration, browser, or deployment
commands. OIDC and SAML use ephemeral in-process HTTPS fixtures; LDAP needs an
actual directory service to exercise TLS, bind, search, and group semantics.

The harness starts a temporary `osixia/openldap:1.5.0` directory on loopback
with a random host port, a one-day local CA, random administrator and user
passwords, and no persisted volume. It generates the following seed only:

- `uid=alice,ou=people,dc=identity-mock,dc=test` (including a real rejected
  bind check);
- `uid=bob,ou=people,dc=identity-mock,dc=test`, so the production client must
  follow a one-entry LDAP page during directory enumeration;
- `uid=disabled,ou=people,dc=identity-mock,dc=test`, whose portable
  `employeeType=disabled` fixture attribute is excluded through the configured user
  search and enumeration filters (rather than a production hard-coded vendor
  account-status rule); and
- `cn=operations,ou=groups,dc=identity-mock,dc=test` containing Alice; and
- `cn=platform-operators,ou=groups,dc=identity-mock,dc=test` containing the
  `operations` group, to exercise nested reverse group resolution. Each group
  has a stable `businessCategory` identifier; the production-client test maps
  that immutable identifier rather than the display CN.

The image's documented configuration supports `LDAP_DOMAIN`,
`LDAP_ADMIN_PASSWORD`, TLS material, and mapping LDAPS port 636; it is pinned
to its published `1.5.0` release rather than using a floating tag. See the
[image configuration reference](https://github.com/osixia/container-openldap).

## Run an LDAP-aware command

Run the maintained production-client test with:

```bash
pnpm run test:identity-ldap-container
```

To run another LDAP-aware command, pass it to the harness directly. The
harness exports connection inputs only to that command and removes the
container, volume, temporary CA, and credentials afterwards. A test must use
the exported values rather than copying them into source:

| Variable | Purpose |
| --- | --- |
| `EG_LDAP_TEST_URL` | Ephemeral `ldaps://localhost:<port>` endpoint. |
| `EG_LDAP_TEST_BIND_DN` | Temporary directory administrator DN. |
| `EG_LDAP_TEST_ADMIN_PASSWORD` | Temporary bind password. |
| `EG_LDAP_TEST_USER_DN` | Seeded Alice DN. |
| `EG_LDAP_TEST_USER_PASSWORD` | Seeded Alice password. |
| `EG_LDAP_TEST_DISABLED_USER_PASSWORD` | Seeded disabled-user password, for proving configured filters fail closed. |
| `EG_LDAP_TEST_CA_CERT_PATH` | Path to the generated CA, for external diagnostic commands only. |
| `EG_LDAP_TEST_CA_CERTIFICATE` | Generated CA supplied through the provider's `tlsTrustRef`, proving provider-scoped strict TLS verification. |

Do not echo these values, store them in a ticket, add them to `.env`, or make
them fixed Compose defaults. The script requires Docker and pulls the pinned
image if it is not available locally. If Docker cannot start the fixture, the
LDAP integration test is unavailable; ordinary authorization tests must still
run without it.
