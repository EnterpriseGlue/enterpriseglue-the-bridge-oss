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
