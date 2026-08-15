# Configure SCIM provisioning

This guide configures an authoritative SCIM 2.0 directory independently from
OIDC or SAML sign-in.

## Before you begin

- Keep at least one tested local recovery administrator.
- Configure and test OIDC or SAML first if provisioned users will use SSO.
- Create explicit Identity mappings for directory groups that should grant
  EnterpriseGlue access. Unmapped SCIM groups are retained but grant nothing.
- Use a secret manager for headless deployments. Never commit a bearer token.

## Configure in the portal

1. Open **Admin → Platform settings → Identity and access → Provisioning**.
2. Select **Create directory**.
3. Enter a stable lowercase directory key, a display name, and optionally the
   related identity-provider key.
4. Leave the initial state disabled while configuring the client.
5. Create a provisioning credential. Copy the Client ID, Client Secret, and
   token endpoint immediately; EnterpriseGlue stores only a hash and
   fingerprint and cannot reveal the secret again. The Client Secret is also a
   backward-compatible static bearer token.
6. Configure the client with the displayed base URL:

   ```text
   https://enterpriseglue.example.com/scim/v2/<directory-key>
   ```

7. Select **Test readiness**. A ready directory is active and has at least one
   active credential.
8. Enable the directory and assign a small pilot group before broad rollout.

## Microsoft Entra-compatible configuration

Use the Enterprise Application provisioning page:

- Tenant URL: the EnterpriseGlue SCIM base URL.
- Secret token: the reveal-once EnterpriseGlue bearer credential.
- For an OAuth-capable client, use the displayed token endpoint, Client ID,
  and Client Secret with the `client_credentials` grant and `scim` scope.
- Provisioning mode: automatic.
- User matching: prefer the client's immutable object identifier as
  `externalId`; use a stable sign-in name for `userName`.
- Required user attributes: `userName`, `active`, and a primary email. Names
  and display name are supported.
- Group matching: use a stable `externalId` and `displayName`; member values
  must reference EnterpriseGlue SCIM User IDs.

Run the provider's connection test, provision one user, update that user's
name, suspend and restore the assignment, and verify each result in the
EnterpriseGlue user detail and provisioning Diagnostics tabs.

## Provider-neutral SCIM contract

EnterpriseGlue supports:

- service-provider, schema, and resource-type discovery;
- User and Group create, retrieve, filter, page, replace, patch, and delete;
- equality filters for User `userName` and `externalId` and Group
  `displayName` and `externalId`;
- ETags and `If-Match` for mutation safety;
- `attributes` and `excludedAttributes` response projection; and
- atomic PATCH behavior;
- deterministic User and Group sorting;
- bounded Bulk requests with prior-operation `bulkId` references; and
- write-only password acceptance that is discarded before persistence.

Local password change remains unsupported and is advertised as such. A client
may send `password` to satisfy its connector contract, but the value is never
stored or used for authentication.

## Headless configuration

Import `./identity-provisioning-directories.json` from the configuration-bundle
manifest. Only secret references are portable:

<!-- enterpriseglue-config-schema: ConfigIdentityProvisioningDirectoriesFileSchema -->
```json
{
  "identityProvisioningDirectories": [
    {
      "key": "entra-workforce",
      "displayName": "Microsoft Entra workforce",
      "description": "Authoritative employee and group lifecycle",
      "identityProviderKey": "identity.oidc.entra",
      "enabled": false,
      "authoritative": true,
      "credentialSecretRef": "env://ENTERPRISEGLUE_SCIM_ENTRA_TOKEN"
    }
  ]
}
```

Preview and secret preflight must pass before apply. Export returns the secret
reference, never a resolved token or hash. A `config_locked` directory is
read-only in the portal; a `config_warn` directory can be changed locally but
the next configuration apply may overwrite drift.

For a completely unattended lifecycle, bootstrap a dedicated API client with
the `identity:provisioning:manage` scope and
`system.api.identity_provisioning_admin` role. Use the secret-safe CLI to
generate an initial credential offline or create/rotate it through the API:

```bash
pnpm admin:provisioning-credential generate ./entra-workforce.scim.secret
```

API create and rotate require an `Idempotency-Key`. Their reveal-once response
is non-cacheable and a repeated key returns `409` instead of replaying the
secret. See [Headless identity-provisioning control plane](../development/headless-identity-provisioning.md)
for bootstrap, rotation order, failure recovery, and developer invariants.

## Rollout checks

- Confirm an unsafe existing-email collision returns `409` and creates no link.
- Confirm a pre-linked SSO account is reused only through the associated
  provider.
- Confirm directory removal invalidates an active browser session.
- Confirm unrelated manual or configuration-owned access remains.
- Rotate the initial credential after the pilot and revoke it after the
  overlap window.

## Resolve an existing-account collision

EnterpriseGlue does not expose a force-link endpoint. A `409 uniqueness`
response is intentionally fail-closed and appears as a sanitized failed event
in the directory's **Diagnostics** tab.

1. Confirm the existing user and the directory assignment represent the same
   person outside EnterpriseGlue.
2. Associate the provisioning directory with the intended OIDC or SAML
   provider.
3. Have the existing user complete a verified sign-in with that provider so
   EnterpriseGlue records the provider subject on the exact account.
4. Retry provisioning. EnterpriseGlue reuses the account only when that
   provider link is active and records `identity.provisioning.user.link`.

Do not resolve a collision by changing an email temporarily, editing the
database, or creating an unverified link. Local recovery administrators remain
ineligible for automatic linking even after a provider association exists.

See [SCIM and user-lifecycle API](../reference/scim-and-user-lifecycle-api.md)
for exact routes and errors.
