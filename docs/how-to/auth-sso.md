# Auth and SSO Setup

Summary: Configure authentication, admin bootstrap, and SSO providers.

Audience: Developers and architects.

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

### 5) Minor operational checks (recommended)
- Confirm Entra **Identifier (Entity ID)** exactly matches the provider `entityId` value in EnterpriseGlue.
- Confirm Entra **Reply URL / ACS URL** points to `https://<your-app-domain>/api/auth/saml/callback`.
- Use `GET /api/auth/saml/status` to verify provider availability.
- Use `GET /api/auth/saml/metadata` when you need SP metadata for IdP setup/review.

## Google OAuth (Optional)
Set the following when enabling Google OAuth:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

## Email (Optional)
- `RESEND_API_KEY` enables email flows (verification/reset).

## Notes
- Ensure redirect URIs use production domains outside local development.
- Rotate secrets if any credentials are exposed.
