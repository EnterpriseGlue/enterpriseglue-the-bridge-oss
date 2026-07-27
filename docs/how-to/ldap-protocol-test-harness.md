# Identity Test Setup

Use the grouped `test:identity:*` commands to choose the smallest relevant
test lane. The pre-existing dashed commands remain supported for CI jobs and
automation that already use them.

| Command | Boundary covered | External dependency |
| --- | --- | --- |
| `pnpm run test:identity:contract` | normalization, mapping, provider, replay, and migration services | none |
| `pnpm run test:identity:routes` | authentication and Platform Admin HTTP routes | none |
| `pnpm run test:identity:matrix` | OIDC/SAML/LDAP normalized-identity and entitlement-to-group parity matrix: authenticated, group, role, and allowlisted attribute mappings must create the same internal memberships; OAuth scopes are normalized but rejected as human access mappings | none |
| `pnpm run test:identity:protocol` | loopback OIDC and SAML transport fixtures plus mock contracts | none |
| `pnpm run test:entra:compatibility` | deterministic Entra-compatible OIDC claims: tenant/object IDs, immutable groups, app roles, expected audience, and fail-closed group overage | none |
| `pnpm run test:identity:ui` | provider and mapping administration screens | none |
| `pnpm run test:identity:local` | all of the preceding local-only lanes | none |
| `pnpm run test:identity:browser` | configure, apply, login, and reconciliation browser lifecycle using the in-browser identity stack | local frontend and Playwright Chromium |
| `pnpm run test:authz:browser` | Access Control responsive permission-catalog layout at tablet width | local frontend and Playwright Chromium |
| `pnpm run test:identity:ldap` | real LDAPS bind, search, TLS, and nested-group flow | Docker |
| `pnpm run test:entra:local-rehearsal` | real browser authorization-code flow against a separate local Keycloak Entra-compatible client, with an app-role-to-engine-access mapping | Docker, local TLS, and Playwright Chromium |
| `pnpm run test:identity:verify` | complete local identity verification, including browser lifecycle and LDAPS | local frontend, Playwright Chromium, and Docker |
| `pnpm run test:identity:protocol-rehearsal` | disposable Docker deployment plus generic OIDC, Entra-compatible OIDC, signed SAML, and LDAPS browser rehearsals | Docker, local TLS, and Playwright Chromium |
| `pnpm run test:entra:real-rehearsal` | opt-in browser authorization-code flow against Microsoft Entra ID, including a role mapping, scoped access, and revocation | dedicated Entra test tenant and dedicated EnterpriseGlue test environment |

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

## Entra compatibility coverage

The repository has two local Entra-compatible layers. Neither claims to emulate
the Microsoft service; both exist to give fast, repeatable coverage around the
claims and authorization boundary EnterpriseGlue owns.

`test:entra:compatibility` uses an in-process OIDC profile with a
tenant-specific Microsoft issuer shape and the claims EnterpriseGlue consumes:
`sub`, `oid`, `tid`, `preferred_username`, immutable group identifiers, and
app roles. It proves expected-audience checking and that Entra's `hasgroups`,
`_claim_names`, or `_claim_sources` group-overage markers fail closed before
any identity or membership write.

`test:entra:local-rehearsal` uses a separate public Keycloak client and a real
browser authorization-code redirect. Its fixture user emits a synthetic Entra
tenant ID and object ID, the immutable group `group-id-operators`, and the app
role `enterpriseglue.engine_operator`. The browser creates the provider and an
atomic **role** mapping through the UI, proves access to only its assigned
engine, and proves immediate denial after mapping disablement. It is included
in the disposable protocol rehearsal below.

## Disposable OIDC, SAML, LDAP, and Entra-compatible rehearsal

`test:identity:protocol-rehearsal` is the production-shaped local acceptance
lane used by the advisory GitHub Actions workflow. It creates its own Docker
Compose project, database volume, localhost ports, TLS CA, platform
administrator, and IdP/LDAP inputs. It then runs the maintained generic OIDC,
Entra-compatible OIDC, SAML, and LDAP browser runners against that one stack. It does not reuse an existing
developer deployment or any customer IdP credentials.

```bash
pnpm exec playwright install chromium
pnpm run test:identity:protocol-rehearsal
```

Success requires all four protocol runners to pass. On either success or
failure it retains service logs, Compose status, protocol runner logs, and
Playwright output under `.artifacts/identity-protocol-rehearsal/`; generated
credentials, TLS private keys, and the temporary environment file are removed
and are never retained as artifacts. The command finishes by removing the
dedicated Docker project and volume.

The CI workflow is intentionally advisory while its fresh-stack behavior is
observed. Once stable, change its documented `continue-on-error` setting to
`false` and add it to branch protection. It is not evidence for a customer
provider cutover: those still require the customer-owned IdP and Effective
Access acceptance procedure.

## Real Microsoft Entra ID rehearsal

`test:entra:real-rehearsal` is intentionally disabled unless all explicit
gates and inputs are supplied. It must use a dedicated test tenant and a
dedicated EnterpriseGlue test environment—never a customer or production
tenant. The runner creates and removes its provider, mapping, group, and test
engine through the normal administration UI/API. It uses an app role by default
because app roles avoid Entra group-overage ambiguity for business personas.

Prepare the dedicated Entra app registration before enabling the runner:

1. Register the exact EnterpriseGlue test callback URL ending in
   `/api/auth/identity/callback`.
2. Create the app role `enterpriseglue.engine_operator` and assign it to a
   synthetic, non-MFA test user. The test uses the authorization-code flow;
   it does not use ROPC.
3. If the app is confidential, ensure the deployed EnterpriseGlue test
   environment already resolves the configured `clientSecretRef`. The runner
   never receives or transmits a raw client secret.
4. Provide a disposable/test engine endpoint that the EnterpriseGlue test
   environment is allowed to register. The runner never touches an existing
   engine.

For a manual rehearsal, set the following values through your shell or secure
CI secret store. Values marked as secrets must never be committed or printed:

```bash
export ENTRA_ID_REHEARSAL_ENABLED=true
export ENTRA_ID_REHEARSAL_TEST_TENANT=true
export ENTRA_ID_REHEARSAL_ALLOW_EXTERNAL=true
export ENTRA_ID_REHEARSAL_BASE_URL='https://enterpriseglue-idp-test.example.test'
export ENTRA_ID_REHEARSAL_TENANT_ID='your-dedicated-test-tenant-id'
export ENTRA_ID_REHEARSAL_CLIENT_ID='your-test-app-client-id'
export ENTRA_ID_REHEARSAL_PLATFORM_ADMIN_EMAIL='secret'
export ENTRA_ID_REHEARSAL_PLATFORM_ADMIN_PASSWORD='secret'
export ENTRA_ID_REHEARSAL_USERNAME='secret'
export ENTRA_ID_REHEARSAL_PASSWORD='secret'
export ENTRA_ID_REHEARSAL_ENGINE_BASE_URL='https://test-engine.example.test/engine-rest'
pnpm run test:entra:real-rehearsal
```

Optional inputs are `ENTRA_ID_REHEARSAL_CLIENT_SECRET_REF`,
`ENTRA_ID_REHEARSAL_ENTITLEMENT_TYPE`,
`ENTRA_ID_REHEARSAL_ENTITLEMENT_ID`, and `ENTRA_ID_REHEARSAL_ENGINE_TYPE`.
The repository workflow `Microsoft Entra ID Rehearsal (Opt-in)` runs only after
the protected `entra-id-test` environment is configured. Its weekday schedule
is inactive until repository variable `ENTRA_ID_REHEARSAL_SCHEDULED` is set to
`true`.

`test:authz:browser` uses the same guarded local browser runner, disables E2E
seeding, and intercepts its API requests. It verifies the real Access Control
permission catalog at a 768px viewport with a long permission label, including
an explicit wrap rule and no document-level horizontal overflow.

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
- `cn=platform-operators-renamed,ou=groups,dc=identity-mock,dc=test`
  containing the `operations` group, to exercise nested reverse group
  resolution through a renamed display CN. Each group has a stable
  `businessCategory` identifier; the production-client test maps that
  immutable identifier rather than the display CN, then removes the renamed
  group and proves the stale entitlement disappears.

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
