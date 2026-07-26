# Auth and SSO Setup

Summary: Configure authentication, admin bootstrap, and SSO providers.

Audience: Developers and architects.

EnterpriseGlue supports provider-neutral OIDC, SAML, and LDAP identity providers. Configure them in **Platform Settings → Identity Providers** or through configuration bundles. For configuration-bundle schemas and entitlement-to-group assignments, see [Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md).

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

Create an enabled direct OIDC, SAML, or LDAP provider with secret references only. The login page reads `/api/auth/providers/enabled` and starts the selected provider at `/api/auth/providers/{providerId}/start`; SAML assertions post to `/api/auth/providers/saml/callback`.

Create **Identity Mappings** from stable upstream entitlements to internal groups, then grant platform, project, engine, or runtime-resource roles to those groups. Test the connection and perform a controlled sign-in before enabling SSO enforcement.

When any direct SSO provider is enabled, password login remains disabled for
ordinary local accounts. The break-glass exception is limited to an active local
account that still has a password and an active canonical Platform Administrator
membership. Verified-email linking does not replace that account's local
authentication method or password. Removing its administrator membership closes
the exception immediately.

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

Rollback is intentionally simple: disable the affected provider and restore local break-glass access while correcting its mapping or secret reference.

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
  "apiVersion": "enterpriseglue.ai/v1alpha1",
  "kind": "EnterpriseGlueConfigBundle",
  "metadata": {
    "key": "bundle.corporate-sso",
    "owner": "identity-platform"
  },
  "tenantKey": "platform",
  "mode": "authoritative",
  "settings": {},
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
        "scopes": ["openid", "profile", "email", "groups"],
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

Identity mappings support the same explicit ownership modes as other
configuration-managed access objects. `config_locked` (the default) prevents
local changes. `config_warn` permits a local edit of the mapping and marks it
as `drifted`; the next reviewed bundle apply restores the mapping declared in
the bundle. Local deletion remains unavailable for both modes: disable or edit
a `config_warn` mapping for a temporary change, or remove it from the bundle
for an authoritative removal. The Identity Mappings page shows **Managed by
config** or **Config warning** accordingly.

When startup apply changes identity mappings, EnterpriseGlue drains the stored
identity snapshots affected by that apply before `/ready` opens. The drain is
bounded to 100 pages of 500 identities. Failure, cancellation, deferred retry,
or budget exhaustion keeps readiness closed with a generic
`identity_reconciliation_failed` issue code. Live directory synchronization and
unrelated API applies continue to use their background workers.

Provider credentials must remain in the configured environment or file secret
provider. They are not copied into bundle JSON, health responses, logs, metrics,
or apply receipts.

## Email (Optional)
- Seed the default email configuration with `EMAIL_*` variables on first deploy so verification/reset flows work out of the box.

## Notes
- Ensure redirect URIs use production domains outside local development.
- Rotate secrets if any credentials are exposed.
