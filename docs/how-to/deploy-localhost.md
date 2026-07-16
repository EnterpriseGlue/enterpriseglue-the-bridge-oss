# Localhost Deployment (Host-Based Production-Style Run)

Summary: Run a host-based production-style build locally using the `deploy-localhost.sh` script.

Audience: Developers and architects.

## When to use this
- You want a local “production-style” build (compiled backend + built frontend preview).
- You are not using Docker Compose, or want to validate the production build pipeline locally.

## Prerequisites
- Node.js (LTS recommended)
- pnpm
- PostgreSQL accessible locally or remotely
- Backend and frontend environment files configured

## Required environment files

### Backend
Create `backend/.env` from `backend/.env.example` and configure at least:
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- Optional: `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin (created from `ADMIN_EMAIL` on first run) to bypass email verification
- `NODE_ENV`
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_SCHEMA`

### Frontend
Create `frontend/.env.local` (or `.env`) with at least:
- `API_BASE_URL` (preferred) or `VITE_API_BASE_URL`

## First-time install (recommended)

From the repo root:

```bash
# Full rebuild (cleans node_modules and dist folders)
bash ./scripts/deploy-localhost.sh --full --first-time
```

This will:
- Validate required backend/frontend env vars
- Install workspace dependencies from the repo root lockfile when they are missing
- Install a missing DB driver into local `node_modules` when required by `DATABASE_TYPE`
- Build backend (`backend/dist`)
- Build frontend (`frontend/dist`)
- Start backend and frontend preview services
- Run database migrations before startup (using your `backend/.env` settings)

If email verification is enabled, seed the default email configuration with `EMAIL_*` variables in `backend/.env` or `.env.selfhost` so verification links work on first deploy. You can still set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` for the seeded admin account if needed.

### Optional authorization configuration bootstrap

Host-based deployments read the bundle directly instead of mounting it into a container. Set an absolute, readable JSON or ZIP path in `.env.selfhost` or `backend/.env`:

```dotenv
EG_CONFIG_BUNDLE_PATH=/srv/enterpriseglue/config/enterpriseglue.json
EG_CONFIG_BOOTSTRAP_MODE=validate
EG_CONFIG_EXPECTED_TENANT_SCOPE=platform
EG_CONFIG_FAIL_CLOSED=true
```

Use `validate` first, review `/health` and `/ready`, then change to `apply` only for an approved hash-bound startup apply. The deployment script rejects enabled bootstrap with a missing, relative, or unreadable `EG_CONFIG_BUNDLE_PATH`. Keep file-backed secrets outside the bundle and configure `EG_CONFIG_SECRET_FILE_ROOT` separately.

## Incremental deploy (after first install)

```bash
bash ./scripts/deploy-localhost.sh
```

Use this for faster rebuilds when dependencies are already installed.

## What the script does
- Stops any running services on backend/frontend ports (defaults: `8787` and `5173`)
- Validates backend and frontend environment variables
- Uses the repo root `pnpm-lock.yaml` when the repo is installed as a pnpm workspace
- Builds backend and frontend
- Starts backend (`node dist/backend/src/server.js`) and frontend preview (`pnpm run preview`)
- Verifies health (`/health`)

## Database migrations
- For first-time installs, pass `--first-time` to run migrations before startup.
- Without `--first-time`, migrations run automatically when the backend starts.
- Ensure `POSTGRES_*` settings are correct and the database is reachable.

If you need to run migrations manually (e.g., to verify before startup):

```bash
cd backend
pnpm run build:skip-generate
pnpm run db:migration:run
```

## Access URLs
- Backend: http://localhost:8787 (default, from `API_PORT`)
- Backend health: http://localhost:8787/health (default)
- Frontend: http://localhost:5173 (default)
- Login: http://localhost:5173/login (default)

## Optional local Keycloak OIDC rehearsal

The repository includes a disposable Keycloak realm that lets you exercise
OIDC discovery and the provider's authorization endpoints locally. It never
modifies EnterpriseGlue SSO mappings or replaces an existing provider.

Start the normal Docker stack first (for example, `pnpm run dev`). Then, from
the repository root, start the overlay using the same active Docker env file:

```bash
docker compose --project-directory . \
  --env-file .local/docker/env/docker.env \
  -f infra/docker/compose/docker-compose.yml \
  -f infra/docker/compose/docker-compose.backend-expose.yml \
  -f infra/docker/compose/docker-compose.keycloak.yml \
  up -d keycloak
```

The provider is available at `http://localhost:8180`, with discovery at
`/realms/enterpriseglue-local/.well-known/openid-configuration`. The imported
realm, client, and disposable test account are defined in
`infra/docker/keycloak/enterpriseglue-local-realm.json`. They are development
fixtures only: do not reuse their credentials, realm export, or container
configuration outside localhost.

Use the following command to confirm that the service is healthy and discovery
is available:

```bash
curl --fail --silent --show-error \
  http://localhost:8180/realms/enterpriseglue-local/.well-known/openid-configuration \
  | jq '{ issuer, authorization_endpoint, token_endpoint }'
```

### HTTPS provider rehearsal

EnterpriseGlue only accepts HTTPS OIDC issuer and callback URLs. Use the
following opt-in overlay when you need to configure and exercise a real local
provider without weakening that product validation. It generates a new,
seven-day CA and server certificate under the ignored `.local/` directory; no
private key or reusable credential is committed.

```bash
./infra/docker/keycloak/generate-local-tls.sh

docker compose --project-directory . \
  --env-file .local/docker/env/docker.env \
  -f infra/docker/compose/docker-compose.yml \
  -f infra/docker/compose/docker-compose.backend-expose.yml \
  -f infra/docker/compose/docker-compose.keycloak.yml \
  -f infra/docker/compose/docker-compose.keycloak-tls.yml \
  up -d backend keycloak frontend-tls
```

The TLS overlay deliberately makes Keycloak share the backend's local network
namespace. Consequently, `https://localhost:8180` is both the browser-visible
issuer and the address used by the backend for discovery and token exchange;
there is no Docker-only issuer hostname to leak into application settings.
The TLS frontend proxy is available at `https://localhost:5443`.

Verify both endpoints with the generated CA:

```bash
curl --fail --silent --show-error \
  --cacert .local/docker/keycloak-tls/ca.crt \
  https://localhost:8180/realms/enterpriseglue-local/.well-known/openid-configuration \
  | jq '{ issuer, authorization_endpoint, token_endpoint }'

curl --fail --silent --show-error \
  --cacert .local/docker/keycloak-tls/ca.crt \
  https://localhost:5443/login >/dev/null
```

For the disposable local provider, configure `https://localhost:8180/realms/enterpriseglue-local`
as the issuer and use the application's shared
`https://localhost:5443/api/auth/identity/callback` callback URL. The imported
client is public and requires PKCE, so the local provider configuration does
not need a client secret reference.

To configure that provider through the application API, use an existing local
platform-administrator account. The helper never reads Docker environment
values or prints credentials, tokens, cookies, or API responses; it only
targets local HTTPS hosts and connection-tests the newly configured provider.

```bash
LOCAL_OIDC_ADMIN_EMAIL='your-local-admin@example.test' \
LOCAL_OIDC_ADMIN_PASSWORD='your-local-admin-password' \
./scripts/configure-local-oidc-provider.sh
```

It defaults to the Keycloak issuer, public client, generated CA, TLS frontend,
and provider key shown above. Override only the documented `LOCAL_OIDC_*`
variables when rehearsing a different localhost instance. The provider is
enabled only after the authenticated configuration call succeeds; remove or
disable the disposable provider when the rehearsal is complete.

Playwright does not import this disposable CA into Chromium. The guarded local
browser lane can therefore opt into certificate-error handling only for this
localhost rehearsal:

```bash
PLAYWRIGHT_BASE_URL=https://localhost:5443 \
PLAYWRIGHT_LOCAL_CA_FILE=.local/docker/keycloak-tls/ca.crt \
PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true \
pnpm test:identity:browser
```

This is local protocol and browser-flow evidence only. It does not replace the
representative deployed-provider cutover evidence described below.

## Optional local sign-in smoke

After the stack is healthy, verify a real login with an existing disposable
local account. This test never seeds a user or prints credentials, and accepts
only localhost, loopback, or `.local` URLs.

```bash
E2E_USER='local-admin@example.test' \
E2E_PASSWORD='your-local-password' \
PLAYWRIGHT_BASE_URL='http://localhost:5173' \
pnpm test:authz:local-smoke
```

This guarded local-only lane verifies sign-in, Access Control navigation, and
the authorized Runtime Resources, SSO Engine Assignments, and Effective Access tab surfaces. The narrower
`test:authz:local-login` and `test:authz:local-access-control` commands remain
available for targeted reruns.

The Access Control smoke also evaluates one catalog platform permission for the
authenticated local administrator through the Effective Access UI. This proves
the local evaluator path; it does not replace representative external-provider
sign-in evidence required for a legacy-provider cutover.

If Chromium is not installed for this workspace, run `pnpm exec playwright
install chromium` once. The command fails rather than skipping if either
credential is absent.

## Logs
- Backend: `tail -f backend/server.log`
- Frontend: `tail -f frontend/preview.log`

## Troubleshooting
- If you see missing env errors, update `backend/.env` or `frontend/.env.local`.
- If ports are in use, stop conflicting services or change ports.
- For database errors in tests, see [Troubleshooting](troubleshooting.md).
