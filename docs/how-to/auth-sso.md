# Auth and SSO Setup

Summary: Configure authentication, admin bootstrap, and SSO providers.

Audience: Developers and architects.

The instructions below cover both the legacy provider-specific setup and the implemented provider-neutral OIDC/SAML/LDAP model. For configuration-bundle schemas and entitlement-to-group assignments, see [Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md).

## JWT and Admin Bootstrap
Required variables:
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

For production, generate a strong JWT secret:
```bash
openssl rand -base64 32
```

## Microsoft Entra ID via OAuth (Optional)
Set the following when enabling Entra ID OAuth/OIDC:
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `MICROSOFT_REDIRECT_URI`

Use this redirect URI in the Entra app registration:
- `https://<your-app-domain>/api/auth/microsoft/callback`

For local dev with the backend exposed directly:
- `http://localhost:8787/api/auth/microsoft/callback`

## Microsoft Entra ID as SAML 2.0 IdP (Recommended for SAML assertions)

### 1) Configure SAML provider in Platform Admin
Go to **Platform Settings → SSO**, create a provider with:
- `type`: `saml`
- `name`: e.g. `Microsoft Entra ID (SAML)`
- `entityId`: your Service Provider identifier (must match Entra Identifier)
- `ssoUrl`: Entra Login URL (IdP SSO URL)
- `certificate`: Entra SAML signing certificate (X.509)
- `signatureAlgorithm`: `sha256` (recommended)
- `enabled`: `true`

### 2) Configure EnterpriseGlue callback URL in Entra
Use the Assertion Consumer Service endpoint:
- `https://<your-app-domain>/api/auth/saml/callback`

For local dev with Vite proxy/Nginx same-origin:
- `http://localhost:5173/api/auth/saml/callback`

### 3) Optional metadata endpoint
EnterpriseGlue exposes SP metadata at:
- `GET /api/auth/saml/metadata`

### 4) Login flow
When a SAML provider is enabled, the login page shows an SSO button and redirects to:
- `GET /api/auth/saml` → `/api/auth/saml/start` → Entra IdP

Entra posts SAML assertion to:
- `POST /api/auth/saml/callback`

On success, EnterpriseGlue provisions/updates the user and issues platform JWT cookies.

The callback URL is intentionally global. Tenant context is carried through the
validated OAuth `state` / SAML `RelayState` value when login starts from
`/t/:tenantSlug/login`, then EnterpriseGlue redirects back to `/t/:tenantSlug/`
after the callback. Do not add `/t/:tenantSlug` to the Entra redirect URI or SAML
Reply URL.

Enterprise extensions can register `app.locals.onSsoUserProvisioned` to attach a
provisioned SSO user to a tenant after the shared OSS auth flow validates the
provider callback and before JWT cookies are issued. The hook receives:
- `provider`: `microsoft` or `saml`
- `providerId`: SAML provider id when available
- `tenantSlug`: sanitized slug from state, or `null`
- `returnTo`: safe internal post-login path
- `user` and `userInfo`

### 5) Minor operational checks (recommended)
- Confirm Entra **Identifier (Entity ID)** exactly matches the provider `entityId` value in EnterpriseGlue.
- Confirm Entra **Reply URL / ACS URL** points to `https://<your-app-domain>/api/auth/saml/callback`.
- Confirm Entra OAuth **Redirect URI** points to `https://<your-app-domain>/api/auth/microsoft/callback`.
- Use `GET /api/auth/saml/status` to verify provider availability.
- Use `GET /api/auth/saml/metadata` when you need SP metadata for IdP setup/review.

## Google OAuth (Optional)
Set the following when enabling Google OAuth:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

## Migrate A Legacy Microsoft, Google, OIDC, Or SAML Provider

Use this procedure to move from a legacy Microsoft, Google, OIDC, or SAML flow
to an exact-provider-bound provider-neutral OIDC or SAML provider. The migration
assistant creates a disabled draft only. It never decrypts, copies, or displays
a legacy client secret or signing certificate.

1. In **Platform Settings -> Identity Providers**, choose **Migrate legacy
   provider** or **Migrate environment configuration** and prepare the draft.
2. Register the draft's callback URL with the identity provider. For OIDC this
   is normally `https://<your-app-domain>/api/auth/identity/callback`.
3. Add a secret reference to the draft instead of entering an OIDC client
   secret or SAML signing certificate in EnterpriseGlue. A persisted legacy
   provider requires a newly managed secret reference. An environment migration
   may temporarily reference
   `env://MICROSOFT_CLIENT_SECRET` or `env://GOOGLE_CLIENT_SECRET` while those
   variables remain available to the backend.
4. Create active **Identity Mappings** from the provider's stable claims to
   internal groups. Roles remain assigned to those groups at platform, project,
   engine, or runtime-resource scope. Do not use a provider-level default role;
   an `exists` mapping to a normal internal group is the supported default-access
   mechanism.
5. Save the new direct OIDC or SAML provider disabled, test its connection, then
   enable it only for a controlled sign-in test. Provider-neutral login begins at
   `/api/auth/identity/<provider-key>/start`.
6. From the provider row menu, run **Check migration readiness**. Cut over only
   when it reports no blockers: the target must be an enabled direct provider
   with the protocol expected for the selected legacy source (OIDC for legacy
   Microsoft, Google, or OIDC; SAML for legacy SAML), an available external
   secret or certificate reference, and at least one active identity mapping.
7. Validate a representative user end to end: sign-in, tenant redirect, group
   membership, engine visibility, project access, and an authorization decision
   in Effective Access. Keep a local break-glass platform administrator usable
   throughout the transition.
8. Disable the old provider only after the controlled test passes. Use the
   guarded cutover action and retain the evidence described in the
   [legacy identity provider cutover runbook](./legacy-identity-provider-cutover-runbook.md).
   EnterpriseGlue does not automatically archive a legacy provider because
   legacy records are platform-global whereas provider-neutral definitions may
   be tenant-scoped.

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

Rollback is intentionally simple: disable the new provider, re-enable the
previous legacy provider, and investigate the new provider's mapping or secret
reference. Do not remove environment variables or legacy provider records until
the new login path has been validated in the intended environment.

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
