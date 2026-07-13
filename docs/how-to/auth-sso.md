# Auth and SSO Setup

Summary: Configure authentication, admin bootstrap, and SSO providers.

Audience: Developers and architects.

The instructions below describe the current provider-specific setup. The provider-neutral OIDC/SAML/LDAP, entitlement-to-group mapping, JSON bundle, and CI/CD target workflow is tracked in [Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md). Do not use its planned APIs until implementation is complete.

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

## Migrate A Legacy Microsoft, Google, Or OIDC Provider

Use this procedure to move from the legacy Microsoft/Google/OIDC flows above to
an exact-provider-bound, provider-neutral OIDC provider. The migration assistant
creates a disabled draft only. It never decrypts, copies, or displays a legacy
client secret.

1. In **Platform Settings -> Identity Providers**, choose **Migrate legacy
   provider** or **Migrate environment configuration** and prepare the draft.
2. Register the draft's callback URL with the identity provider. For OIDC this
   is normally `https://<your-app-domain>/api/auth/identity/callback`.
3. Add a secret reference to the draft instead of entering a client secret in
   EnterpriseGlue. A persisted legacy provider requires a newly managed secret
   reference. An environment migration may temporarily reference
   `env://MICROSOFT_CLIENT_SECRET` or `env://GOOGLE_CLIENT_SECRET` while those
   variables remain available to the backend.
4. Create active **Identity Mappings** from the provider's stable claims to
   internal groups. Roles remain assigned to those groups at platform, project,
   engine, or runtime-resource scope. Do not use a provider-level default role;
   an `exists` mapping to a normal internal group is the supported default-access
   mechanism.
5. Save the new direct OIDC provider disabled, test its connection, then enable
   it only for a controlled sign-in test. Provider-neutral login begins at
   `/api/auth/identity/<provider-key>/start`.
6. From the provider row menu, run **Check migration readiness**. Cut over only
   when it reports no blockers: the target must be a direct, enabled OIDC
   provider with an available secret reference and at least one active identity
   mapping.
7. Validate a representative user end to end: sign-in, tenant redirect, group
   membership, engine visibility, project access, and an authorization decision
   in Effective Access. Keep a local break-glass platform administrator usable
   throughout the transition.
8. Disable the old provider only after the controlled test passes. This is a
   manual administrative action today. EnterpriseGlue does not automatically
   archive a legacy provider because legacy records are platform-global whereas
   provider-neutral definitions may be tenant-scoped.

Rollback is intentionally simple: disable the new provider, re-enable the
previous legacy provider, and investigate the new provider's mapping or secret
reference. Do not remove environment variables or legacy provider records until
the new login path has been validated in the intended environment.

For the broader provider-neutral identity and group-mapping model, see
[Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md).

## Email (Optional)
- Seed the default email configuration with `EMAIL_*` variables on first deploy so verification/reset flows work out of the box.

## Notes
- Ensure redirect URIs use production domains outside local development.
- Rotate secrets if any credentials are exposed.
