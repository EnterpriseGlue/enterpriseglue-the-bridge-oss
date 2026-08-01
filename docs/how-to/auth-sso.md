# Auth and SSO Setup

Summary: Configure authentication, admin bootstrap, and SSO providers.

Audience: Developers and architects.

EnterpriseGlue supports provider-neutral OIDC, SAML, and LDAP identity providers. Configure them in **Platform Settings → Identity Providers** or through configuration bundles. For configuration-bundle schemas and entitlement-to-group assignments, see [Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md).

Provider enablement and login enforcement are separate from access authority.
For the exact REST/headless settings contract and the UI behavior of
`manual`, `transition_to_sso`, and `sso_managed`, see
[Access Governance and Headless Configuration API](../reference/access-governance-and-headless-api.md).

## JWT and Admin Bootstrap
Required variables:
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

For production, generate a strong JWT secret:
```bash
openssl rand -base64 32
```

## Configure a direct identity provider

Create an enabled direct OIDC, SAML, or LDAP provider with secret references
only. Give every provider a user-facing sign-in name and, when useful, its
organization and accepted email domains. Provider keys remain stable machine
identifiers and are not shown as login-button labels.

The tenant login page reads the sanitized, policy-resolved
`GET /api/t/{tenantSlug}/auth/login-methods` contract. Redirect providers start
at `/api/t/{tenantSlug}/auth/providers/{providerId}/start`; LDAP submits to
`/api/t/{tenantSlug}/auth/providers/{providerId}/login`; OIDC and SAML callbacks
remain platform callback URLs because their signed state carries the resolved
tenant, provider record, and safe return path. The global
`/api/auth/login-methods` and provider start/login routes remain default-tenant
compatibility aliases for older clients. The older
`GET /api/auth/providers/enabled` response remains a compatibility contract
for older clients, but new clients must use `login-methods`.

Create **Identity Mappings** from stable upstream entitlements to internal groups, then grant platform, project, engine, or runtime-resource roles to those groups. Test the connection and perform a controlled sign-in before enabling SSO enforcement.

### Mandatory sign-in reconciliation

Every successful direct OIDC (including Microsoft Entra ID), SAML, and LDAP
sign-in is a reconciliation run. EnterpriseGlue verifies the provider response,
updates the identity snapshot and mapped memberships, and only then issues the
browser session. The `login` trigger and `requiredForLogin: true` are mandatory
in both the API and JSON configuration; the portal displays this as a fixed
security property rather than a toggle.

For an `authoritative` identity mapping, an upstream group or app-role removal
removes only the corresponding provider-managed local membership on the user's
next successful sign-in. An `additive` mapping only adds memberships. Manual
memberships and memberships sourced from another provider are unaffected. If
reconciliation fails, EnterpriseGlue fails closed and issues no session.

Scheduled LDAP directory reconciliation and applying saved membership data are supplementary
ways to refresh identities that have not signed in; they do not replace the
mandatory fresh reconciliation at sign-in. OIDC/Entra obtains fresh verified
claims through the sign-in flow. A future Graph or SCIM poller would be a
separate background capability, not an opt-out from this requirement.

### Portal language and API values

The portal uses outcome-based language. JSON and REST interfaces retain stable
machine values:

| Portal wording | JSON/API value | Exact behavior |
| --- | --- | --- |
| **Users sign in through this provider** | `authenticationMode: "direct"` | The provider appears as a sign-in method. |
| **Accept trusted claims from a gateway** | `authenticationMode: "claims_only"` | EnterpriseGlue accepts verified upstream identity facts; the provider is not shown on the login page. |
| **Add and remove members to match the provider** | `syncMode: "authoritative"` | Provider-managed membership is added and removed to match fresh provider evidence. Other providers and manual membership are not changed. |
| **Add matching members only** | `syncMode: "additive"` | Matching membership is added; an upstream removal does not remove the existing membership. |
| **Block sign-in until the refresh succeeds** | `sync.incompleteEntitlements: "fail_closed"` | No session is issued when membership evidence is incomplete. |
| **Keep previous memberships until a refresh succeeds** | `sync.incompleteEntitlements: "preserve_previous"` | Earlier provider-managed access remains temporarily; the portal shows a warning. |
| **Managed by configuration** | `ownershipMode: "config_locked"` | Fields and destructive actions are read-only in the portal and rejected again by mutation APIs. |
| **Configuration-linked** | `ownershipMode: "config_warn"` | A portal/API edit is allowed, records drift, and may be overwritten by the next bundle apply. |

**Preview membership changes** and **Check saved identities** never change
identity or access and never contact the provider. **Apply saved membership
data** calls `POST /api/identity/providers/{key}/replay-memberships`; it uses
the most recently stored provider data, does not contact the provider, and
applies membership changes immediately. The portal requires a confirmation and
reports checked, added, removed, failed, and remaining-record counts.

**Disable provider** calls `DELETE /api/identity/providers/{key}`. In the
current data model this sets `isEnabled` to `false`; there is no separate
archived state. Sign-in through that provider stops and provider-managed
memberships are removed, while mappings, refresh history, manual access, and
API-managed access remain available for diagnosis or recovery.

In local OSS, the logged-out provider chooser reads the canonical
`tenant-default` providers first and then legacy platform-scoped provider rows
as a compatibility fallback, even when the browser uses `/t/default/login`.
In a tenant-aware deployment, the `/api/t/{tenantSlug}/auth/*` routes run the
pre-authentication tenant resolver before discovery or credential handling;
EnterpriseGlue never enumerates providers from other tenants. The signed
OIDC/SAML state records the selected provider and tenant, so the callback cannot
switch scope. Do not implement multi-tenant login by sending `x-tenant-slug` to
the global compatibility aliases.

At most one provider can be preferred in each tenant scope. The service changes
the previous preferred row and the new preferred row in one TypeORM transaction,
while a database unique identity prevents concurrent writes from creating two
preferred providers. Existing duplicate rows are migrated deterministically;
all providers remain enabled and only the duplicate preferred flags are cleared.

### Login experience policy

Configure login behavior in **Platform Settings → Identity Providers** or in
the top-level `login` block of a `v1beta1` configuration bundle. Login policy
is independent from engine/project access authority and from whether the
provider row is portal- or configuration-managed.

| Setting | Value | Logged-out behavior |
| --- | --- | --- |
| Local password | `auto` | Show ordinary local credentials only when no direct provider is enabled. This preserves standalone installs and hides them after SSO is introduced. |
| Local password | `enabled` | Show local credentials alongside organization methods. Use only for a deliberate transition period. |
| Local password | `disabled` | Never accept ordinary local password login. Administrator recovery remains separate. |
| Provider selection | `auto_redirect_single` | Redirect only when local password is unavailable and exactly one redirect-capable provider is enabled. LDAP never auto-redirects. |
| Provider selection | `chooser` | Show all enabled methods in preferred/display order. |
| Provider selection | `progressive` | Ask for a work email, match only its domain to provider metadata, then redirect or narrow the chooser. The response never reveals whether an account exists. |

With zero providers, `localPassword: auto` keeps the standalone form
available. With one provider, EnterpriseGlue can use a single primary action
or a policy-controlled redirect. With multiple providers it presents their
friendly names; raw provider keys and generated fixture identifiers are not
login labels. A failed login-method lookup fails closed with an actionable
error instead of guessing a local or SSO route.

The portal's **What users will see** panel resolves the saved provider rows
against the current policy and previews automatic redirect, work-email
discovery, provider chooser, local-password, and no-method states. It is a
presentation preview, not a connection test. Provider forms start without
premature error states, validate fields after interaction, and focus the first
invalid field after submission. Always run **Test connection** before enabling
a provider.

The login page exposes password fields to browsers and password managers with
the standard `username` and `current-password` autocomplete purposes, permits
paste, and provides a password-reveal control. Redirect flows announce the
selected provider before navigation and provide a short opportunity to choose
another method. A returned or failed redirect suppresses immediate
auto-redirect so the user can select a recovery path instead of entering a
loop.

The public response contains only:

<!-- enterpriseglue-config-schema: PublicLoginMethodsResponseSchema -->
```json
{
  "localPassword": { "enabled": false },
  "providerSelection": "progressive",
  "autoRedirectProviderId": null,
  "providers": [
    {
      "id": "provider-record-id",
      "key": "identity.corporate-entra",
      "displayName": "Microsoft Entra ID",
      "organization": "Example Corporation",
      "protocol": "oidc",
      "loginMethod": "redirect",
      "preferred": true,
      "loginDomains": ["example.com"]
    }
  ],
  "configurationStatus": "ready"
}
```

It does not expose client secrets, issuer internals, directory credentials,
mapping rules, or account existence.

### Privacy-safe login experience metrics

`GET /metrics` exports process-local counters and elapsed-time aggregates:

- `enterpriseglue_login_experience_total{method,event}`
- `enterpriseglue_login_experience_duration_ms_sum{method,event}`
- `enterpriseglue_login_experience_duration_ms_count{method,event}`

Methods are the bounded values `local`, `recovery`, `oidc`, `saml`, and
`ldap`. Events are `selected`, `succeeded`, `failed`, and `redirect_failed`.
The metrics deliberately contain no user, email, domain, provider, tenant, IP,
request, or session label. Durations are capped at ten minutes. Use these
aggregates to detect redirect failures and unusually slow authentication
without turning the login page into an identity-tracking surface.

### Administrator recovery

When ordinary local login is disabled, the main login endpoint has no hidden
administrator exception. Recovery uses the separate, deliberately
non-advertised `/admin-recovery` page and
`POST /api/auth/recovery/login`. It accepts only an active local account with
a password and an active canonical Platform Administrator membership.
Verified-email linking does not replace that account's local authentication
method or password. Removing its administrator membership closes recovery
immediately. Monitor and audit use of this route, test it before SSO
enforcement, and keep its URL in the operator runbook rather than on the
ordinary login page.

Unlinking a provider identity marks that provider/subject link and normalized
snapshot as unlinked, removes only memberships sourced from that provider,
and revokes only refresh sessions issued through that provider for the linked
user. Other provider links, local credentials, and manual access remain intact.
The unlinked subject fails closed. An administrator can use the provider's
**Resolve external identity conflict** action to explicitly unlink a confirmed
subject/account pair; that action is audited and cannot transfer the subject to
another account. Recovery then requires a fresh provider sign-in with a
verified email equal to the recorded provider email, and the provider's
**Allow verified email account linking** setting must be enabled. Any different
email, unverified claim, disabled policy, or missing active local account stays
blocked.

Rollback is intentionally simple: use the recovery route, set ordinary local
login to `enabled` only when a reviewed rollback requires it, then disable or
correct the affected provider or mapping. Do not expose recovery by adding it
back to the normal login form.

For the broader provider-neutral identity and group-mapping model, see
[Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md).

## Configuration-Managed Identity Providers

Configuration bundles may define provider-neutral providers and entitlement
mappings using secret references only. Preview the bundle, verify every mapping
targets an existing internal group, and use secret preflight before apply. Role
access comes from that group's canonical assignments; provider-level default
roles are not the target access model.

### Fully headless SSO example

The EnterpriseGlue side of SSO needs no portal interaction. Keep the following
files in source control, make them a folder-style ZIP with `bundle.json` as
the manifest (or send the equivalent `{ "bundle", "files" }` envelope to the
Config Bundles API), then use the preview/diff/preflight/apply lifecycle in
[Deploy Authorization Configuration](./deploy-authorization-config.md).

This example grants a mapped upstream `enterpriseglue-operators` group a
minimal platform role. Replace that role assignment with your scoped engine,
Engine Set, runtime-resource, or project assignments as appropriate; the SSO
mapping itself stays platform-wide.

`bundle.json`:

<!-- enterpriseglue-config-schema: EnterpriseGlueConfigBundleSchema -->
```json
{
  "apiVersion": "enterpriseglue.ai/v1beta1",
  "kind": "EnterpriseGlueConfigBundle",
  "metadata": {
    "key": "bundle.corporate-sso",
    "owner": "identity-platform"
  },
  "tenantKey": "platform",
  "mode": "authoritative",
  "governance": {
    "engineMembershipAuthority": "sso_managed",
    "projectMembershipAuthority": "manual",
    "engineRegistrationPolicy": "manual_allowed",
    "projectEngineTargetPolicy": "manual_allowed",
    "runtimeAuthorizationAuthority": "enterpriseglue_authoritative",
    "governanceSettingsOwnership": "config_locked"
  },
  "login": {
    "localPassword": "disabled",
    "providerSelection": "progressive"
  },
  "imports": [
    "./roles.json",
    "./groups.json",
    "./assignments.json",
    "./identity-providers.json",
    "./identity-mappings.json"
  ]
}
```

`roles.json` and `groups.json`:

<!-- enterpriseglue-config-schema: ConfigRolesFileSchema -->
```json
{
  "roles": [
    {
      "key": "custom.platform.identity-operator",
      "name": "Identity Operator",
      "scope": "platform",
      "permissions": ["platform:authz:check"]
    }
  ]
}
```

<!-- enterpriseglue-config-schema: ConfigGroupsFileSchema -->
```json
{
  "groups": [
    {
      "key": "group.identity-operators",
      "name": "Identity operators"
    }
  ]
}
```

`assignments.json`:

<!-- enterpriseglue-config-schema: ConfigAssignmentsFileSchema -->
```json
{
  "assignments": [
    {
      "key": "assignment.platform.identity-operators",
      "principal": { "type": "group", "key": "group.identity-operators" },
      "roleKey": "custom.platform.identity-operator",
      "scope": { "type": "platform" }
    }
  ]
}
```

`identity-providers.json`:

<!-- enterpriseglue-config-schema: ConfigIdentityProvidersFileSchema -->
```json
{
  "identityProviders": [
    {
      "key": "identity.corporate-oidc",
      "displayName": "Microsoft Entra ID",
      "organization": "Example Corporation",
      "displayOrder": 10,
      "preferred": true,
      "loginDomains": ["example.com"],
      "type": "oidc",
      "enabled": true,
      "authenticationMode": "direct",
      "directoryTenantId": "corporate-directory",
      "allowVerifiedEmailLinking": false,
      "authorizationAttributeKeys": ["department"],
      "sync": {
        "triggers": ["login", "manual"],
        "requiredForLogin": true,
        "incompleteEntitlements": "fail_closed",
        "connectorCapability": "claim_only",
        "scheduled": false
      },
      "oidc": {
        "issuerUrl": "https://login.example.test/tenant/v2.0",
        "clientId": "enterpriseglue-web",
        "clientSecretRef": "env://CORPORATE_OIDC_CLIENT_SECRET",
        "callbackUrl": "https://enterpriseglue.example.test/api/auth/identity/callback",
        "scopes": ["openid", "profile", "email"],
        "groupClaim": "groups",
        "expectedAudience": "enterpriseglue-web"
      },
      "ownershipMode": "config_locked"
    }
  ]
}
```

`identity-mappings.json`:

<!-- enterpriseglue-config-schema: ConfigIdentityMappingsFileSchema -->
```json
{
  "identityMappings": [
    {
      "key": "mapping.corporate-operators",
      "providerKey": "identity.corporate-oidc",
      "source": {
        "type": "group",
        "externalId": "enterpriseglue-operators",
        "operator": "exact"
      },
      "targetGroupKey": "group.identity-operators",
      "syncMode": "authoritative",
      "ownershipMode": "config_locked"
    }
  ]
}
```

Every provider option is available in the configuration bundle and the direct
provider API: OIDC supports `groupClaim` and `expectedAudience`; SAML supports
metadata by URL or secret reference plus certificate/signature settings; LDAP
supports immutable subject/email attributes, nested groups, paging, and an
optional TLS trust reference. The external IdP client, redirect-URI trust, and
upstream group membership are still configured at the IdP—usually through that
provider's own IaC—not in EnterpriseGlue's bundle.

For CI, supply `CORPORATE_OIDC_CLIENT_SECRET` through the configured secret
provider, run secret preflight, then apply the exact preview hash. Never put
the value itself in JSON or commit it to the repository.

In this example, an administrator can still view existing engine members and
their source lineage, but cannot add, edit, or remove engine access through the
normal member or generic assignment UI/API. New engine access must come from an
identity mapping to a group assignment. Project collaboration stays manual.
The settings themselves are bundle-owned and therefore read-only in Platform
Settings. Use `transition_to_sso` before cutover if manual engine grants need
cleanup; switching to `sso_managed` preserves and freezes remaining manual
rows rather than deleting them.

The mapping wizard creates mapping-derived access atomically. For an existing
mapping, the dedicated `POST /api/identity/mappings/{id}/access` endpoint adds
the selected group role with `source = "sso"` and mapping lineage. It is the
supported portal/API path while engine access is SSO-managed; the generic
manual role-assignment endpoint remains intentionally blocked. A deployment
that deliberately makes project access SSO-managed should declare the
mapping's target-group project assignment in the managed configuration bundle.

Identity mappings support the same explicit ownership modes as other
configuration-managed access objects. `config_locked` (the default) prevents
local changes. `config_warn` permits a local edit of the mapping and marks it
as `drifted`; the next reviewed bundle apply restores the mapping declared in
the bundle. Local deletion remains unavailable for both modes: disable or edit
a `config_warn` mapping for a temporary change, or remove it from the bundle
for an authoritative removal. The Identity Mappings page shows **Managed by
configuration** or **Configuration-linked** accordingly. For `config_locked` providers and
mappings, the row action is **View configuration**, not **Edit**. The modal
keeps bundle-owned fields read-only, explains the owning source, and leaves
non-mutating diagnostics such as connection tests, sample-claims previews, and
saved identity previews available. Grant, delete, and disable actions remain
visibly unavailable and are still rejected by the backend if called directly.

When startup apply changes identity mappings, EnterpriseGlue drains the stored
identity snapshots affected by that apply before `/ready` opens. The drain is
bounded to 100 pages of 500 identities. Failure, cancellation, deferred retry,
or budget exhaustion keeps readiness closed with a generic
`identity_reconciliation_failed` issue code. Live directory synchronization and
unrelated API applies continue to use their background workers.

Provider credentials must remain in the configured environment or file secret
provider. They are not copied into bundle JSON, health responses, logs, metrics,
or apply receipts.

### Microsoft Entra ID

For Entra OIDC, use a tenant-specific issuer URL in the form
`https://login.microsoftonline.com/<tenant-id>/v2.0`, set
`directoryTenantId`, and set `expectedAudience` to the Entra app registration's
client ID. When an ID token contains `tid`, EnterpriseGlue requires it to
equal `directoryTenantId` before it writes an external identity or any mapped
membership. Map immutable Entra group object IDs or app-role values—never display
names. Prefer app roles for business personas because group-overage markers can
leave group claims incomplete; EnterpriseGlue rejects `hasgroups`,
`_claim_names`, and `_claim_sources` fail closed instead of treating them as an
empty group set.

The OIDC `groups` claim is configured at the identity provider. Do not add a
non-standard `groups` OAuth scope unless that provider explicitly requires it;
the portable default remains `openid`, `profile`, and `email`. The local
Entra-compatible and optional real-tenant rehearsals are documented in
[Identity Protocol Rehearsal and LDAP Test Harness](./ldap-protocol-test-harness.md).
An Entra group or app-role change takes effect on the user's next successful
sign-in, when its fresh token claims complete the mandatory reconciliation.

## Email (Optional)
- Seed the default email configuration with `EMAIL_*` variables on first deploy so verification/reset flows work out of the box.

## Notes
- Ensure redirect URIs use production domains outside local development.
- Rotate secrets if any credentials are exposed.
