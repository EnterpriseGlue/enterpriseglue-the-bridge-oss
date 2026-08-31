#!/usr/bin/env bash
set -Eeuo pipefail

# Boots a disposable pooled EnterpriseGlue deployment with a restricted
# PostgreSQL application role, forced tenant RLS, TLS, Keycloak, and OpenLDAP.
# Only diagnostics are retained; credentials, containers, and volumes are
# destroyed at the end of every invocation.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="${POOLED_TENANCY_E2E_ARTIFACT_DIR:-$root_dir/.artifacts/pooled-tenancy-e2e}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/enterpriseglue-pooled-tenancy-e2e.XXXXXX")"
env_file="$temp_dir/pooled-tenancy.env"
tls_dir="$temp_dir/keycloak-tls"
identity_secret_dir="$temp_dir/identity-secrets"
realm_import_file="$temp_dir/enterpriseglue-pooled-realm.json"
postgres_init_file="$temp_dir/10-pooled-tenancy-app-role.sql"
playwright_output_dir="$temp_dir/playwright-results"
project_name="enterpriseglue-pooled-tenancy-${RANDOM}${RANDOM}"

free_loopback_port() {
  node --input-type=module <<'NODE'
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(1);
  process.stdout.write(String(address.port));
  server.close();
});
NODE
}

backend_port="${POOLED_TENANCY_E2E_BACKEND_PORT:-$(free_loopback_port)}"
frontend_port="${POOLED_TENANCY_E2E_FRONTEND_PORT:-$(free_loopback_port)}"
keycloak_port="${POOLED_TENANCY_E2E_KEYCLOAK_PORT:-$(free_loopback_port)}"
tls_frontend_port="${POOLED_TENANCY_E2E_TLS_FRONTEND_PORT:-$(free_loopback_port)}"
postgres_port="${POOLED_TENANCY_E2E_POSTGRES_PORT:-$(free_loopback_port)}"

if ! docker info >/dev/null 2>&1; then
  echo '[pooled-tenancy-e2e] Docker is required.' >&2
  exit 2
fi

mkdir -p "$artifact_dir"
chmod 700 "$artifact_dir"

node - "$root_dir" "$env_file" "$tls_dir" "$identity_secret_dir" "$realm_import_file" "$postgres_init_file" \
  "$backend_port" "$frontend_port" "$keycloak_port" "$tls_frontend_port" "$postgres_port" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [
  rootDir,
  envFile,
  tlsDir,
  identitySecretDir,
  realmImportFile,
  postgresInitFile,
  backendPort,
  frontendPort,
  keycloakPort,
  tlsFrontendPort,
  postgresPort,
] = process.argv.slice(2);
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const hostUid = typeof process.getuid === 'function' && process.getuid() > 0
  ? process.getuid()
  : 65532;
const hostGid = typeof process.getgid === 'function' && process.getgid() > 0
  ? process.getgid()
  : 65532;
const bootstrapPassword = randomHex(24);
const appPassword = randomHex(24);
const appUser = 'enterpriseglue_pooled_app';
const appDatabase = 'enterpriseglue_pooled';
const adminEmail = 'pooled-tenancy-e2e-admin@example.test';
const adminPassword = randomHex(24);
const publicOrigin = `https://localhost:${tlsFrontendPort}`;
const eligibilityKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const eligibilityKeyFile = `${require('node:path').dirname(envFile)}/eligibility-private-key.pem`;
const eligibilityPublicJwk = eligibilityKeys.publicKey.export({ format: 'jwk' });
const invocationKeys = crypto.generateKeyPairSync('ed25519');
const invocationPrivateKeyFile = `${require('node:path').dirname(envFile)}/plugin-invocation-private.pem`;
const invocationPublicKeyFile = `${require('node:path').dirname(envFile)}/plugin-invocation-public.pem`;
const values = {
  NODE_ENV: 'development',
  EG_BACKEND_ENV_FILE: envFile,
  API_PORT: '8787',
  BACKEND_HOST_PORT: backendPort,
  FRONTEND_HOST_PORT: frontendPort,
  FRONTEND_URL: publicOrigin,
  DATABASE_TYPE: 'postgres',
  POSTGRES_SCHEMA: 'main',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: bootstrapPassword,
  POSTGRES_DB: 'postgres',
  POSTGRES_HOST: 'db',
  POSTGRES_PORT: '5432',
  POSTGRES_DATABASE: appDatabase,
  POSTGRES_SSL: 'false',
  POSTGRES_SSL_REJECT_UNAUTHORIZED: 'false',
  POSTGRES_HOST_PORT: postgresPort,
  POOLED_TENANCY_POSTGRES_INIT_FILE: postgresInitFile,
  POOLED_TENANCY_POSTGRES_APP_USER: appUser,
  POOLED_TENANCY_POSTGRES_APP_PASSWORD: appPassword,
  POOLED_TENANCY_POSTGRES_APP_DATABASE: appDatabase,
  POOLED_TENANCY_FRONTEND_DIST: `${rootDir}/frontend/dist`,
  POOLED_TENANCY_PLUGIN_STATE_FILE: `${require('node:path').dirname(envFile)}/plugin-state.json`,
  POOLED_TENANCY_PLUGIN_ASSET_ROOT: `${require('node:path').dirname(envFile)}/plugin-assets`,
  POOLED_TENANCY_PLUGIN_INVOCATION_PRIVATE_KEY_FILE: invocationPrivateKeyFile,
  POOLED_TENANCY_PLUGIN_INVOCATION_PUBLIC_KEY_FILE: invocationPublicKeyFile,
  POOLED_TENANCY_REFERENCE_PLUGIN_DATA_DIR: `${require('node:path').dirname(envFile)}/reference-plugin-data`,
  POOLED_TENANCY_REFERENCE_PLUGIN_UID: String(hostUid),
  POOLED_TENANCY_REFERENCE_PLUGIN_GID: String(hostGid),
  CAMUNDA_MOCK_HOST_PORT: '0',
  JWT_SECRET: randomHex(32),
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: adminPassword,
  ADMIN_EMAIL_VERIFICATION_EXEMPT: 'true',
  ENCRYPTION_KEY: randomHex(32),
  GIT_REPOS_PATH: './data/repos',
  GIT_DEFAULT_BRANCH: 'main',
  API_BASE_URL: '',
  KEYCLOAK_HOST_PORT: keycloakPort,
  KEYCLOAK_INTERNAL_PORT: keycloakPort,
  KEYCLOAK_HTTPS_FRONTEND_PORT: tlsFrontendPort,
  KEYCLOAK_TLS_DIR: tlsDir,
  KEYCLOAK_REALM_IMPORT_FILE: realmImportFile,
  LOCAL_IDENTITY_SECRET_DIR: identitySecretDir,
  E2E_ENGINE_PASSWORD: randomHex(24),
  EG_TENANCY_MODE: 'pooled',
  EG_TENANT_RLS_ENFORCED: 'true',
  EG_TENANT_PLACEMENT_KEY: randomHex(32),
  EG_TENANT_SECRET_BROKER_TOKEN: randomHex(32),
  EG_TENANT_APP_ELIGIBILITY_REQUIRED: 'true',
  EG_TENANT_APP_ELIGIBILITY_JWKS_JSON: JSON.stringify({ keys: [{
    ...eligibilityPublicJwk,
    kid: 'pooled-e2e-eligibility-1',
    alg: 'ES256',
    use: 'sig',
  }] }),
  EG_TENANT_APP_ELIGIBILITY_ISSUER: 'https://pooled-e2e-control.enterpriseglue.test',
  EG_TENANT_APP_ELIGIBILITY_AUDIENCE: 'pooled-e2e-shard',
  POOLED_TENANCY_ELIGIBILITY_PRIVATE_KEY_FILE: eligibilityKeyFile,
  POOLED_TENANCY_OIDC_CLIENT_SECRET: randomHex(24),
  EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY: 'true',
  EG_IDENTITY_PROVIDER_ALLOWED_HOSTS: 'localhost,openldap',
  EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS: 'true',
  EG_IDENTITY_FLOW_RATE_LIMIT_MAX: '500',
  EG_LDAP_RECONCILIATION_IDENTITY_LIMIT: '10000',
  EG_LDAP_RECONCILIATION_CONCURRENCY: '4',
  EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT: '10000',
  EG_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT: '100000',
  EG_LDAP_GROUP_SEARCH_QUERY_LIMIT: '100',
  EG_LDAP_GROUP_SEARCH_RESULT_LIMIT: '5000',
  POOLED_TENANCY_ADMIN_EMAIL: adminEmail,
  POOLED_TENANCY_ADMIN_PASSWORD: adminPassword,
};
fs.writeFileSync(envFile, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
fs.writeFileSync(
  eligibilityKeyFile,
  eligibilityKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  { mode: 0o600 },
);
fs.writeFileSync(
  invocationPrivateKeyFile,
  invocationKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  { mode: 0o644 },
);
fs.writeFileSync(
  invocationPublicKeyFile,
  invocationKeys.publicKey.export({ type: 'spki', format: 'pem' }),
  { mode: 0o644 },
);
fs.writeFileSync(postgresInitFile, [
  `CREATE ROLE ${appUser} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`,
  `CREATE DATABASE ${appDatabase} OWNER ${appUser};`,
  '',
].join('\n'), { mode: 0o600 });

const sourceRealm = JSON.parse(fs.readFileSync(`${rootDir}/infra/docker/keycloak/enterpriseglue-local-realm.json`, 'utf8'));
for (const client of sourceRealm.clients || []) {
  if (['enterpriseglue-local', 'enterpriseglue-local-entra'].includes(client.clientId)) {
    client.redirectUris = [...new Set([...(client.redirectUris || []), `${publicOrigin}/*`])];
    client.webOrigins = [...new Set([...(client.webOrigins || []), publicOrigin])];
  }
  if (client.clientId === 'enterpriseglue-local') {
    client.publicClient = false;
    client.clientAuthenticatorType = 'client-secret';
    client.secret = values.POOLED_TENANCY_OIDC_CLIENT_SECRET;
  }
  if (client.clientId === 'enterpriseglue-local-saml') {
    client.redirectUris = [...new Set([
      ...(client.redirectUris || []),
      `${publicOrigin}/api/auth/providers/saml/callback`,
      `${publicOrigin}/api/t/bravo/auth/providers/saml/callback`,
    ])];
  }
}
fs.writeFileSync(realmImportFile, `${JSON.stringify(sourceRealm, null, 2)}\n`, { mode: 0o644 });
NODE

# These are disposable mount sources used by non-root Linux containers with
# UIDs that may differ from the host runner.
chmod 644 "$postgres_init_file"
mkdir -p "$identity_secret_dir"
chmod 755 "$identity_secret_dir"
mkdir -p "$temp_dir/reference-plugin-data"
chmod 777 "$temp_dir/reference-plugin-data"

compose=(
  docker compose --progress plain
  --project-name "$project_name"
  --project-directory "$root_dir"
  --env-file "$env_file"
  -f "$root_dir/infra/docker/compose/docker-compose.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.identity-protocol-rehearsal.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.e2e-mission-control.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.backend-expose.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.keycloak.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.keycloak-tls.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.keycloak-saml.yml"
  -f "$root_dir/infra/docker/compose/docker-compose.pooled-tenancy-e2e.yml"
)

run_compose() {
  EG_BACKEND_ENV_FILE="$env_file" "${compose[@]}" "$@"
}

capture_diagnostics() {
  run_compose ps --all > "$artifact_dir/compose-status.txt" 2>&1 || true
  for service in db backend frontend frontend-tls keycloak camunda-mock eg-plugin-io-enterpriseglue-reference-health; do
    run_compose logs --no-color --tail=700 "$service" > "$artifact_dir/${service}.log" 2>&1 || true
  done
  if [[ -d "$playwright_output_dir" ]]; then
    rm -rf "$artifact_dir/playwright-results"
    cp -R "$playwright_output_dir" "$artifact_dir/playwright-results"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  capture_diagnostics
  run_compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temp_dir"
  exit "$status"
}
trap cleanup EXIT

cd "$root_dir"
pnpm exec playwright install chromium --dry-run >/dev/null
echo '[pooled-tenancy-e2e] Compiling the backend and SPA from installed workspace dependencies.'
pnpm --filter webmodeler-backend run build
pnpm run build:frontend-host
pnpm --filter webmodeler-frontend run build
pnpm --filter @enterpriseglue/plugin-reference run build

node - "$root_dir" "$temp_dir/plugin-state.json" "$temp_dir/plugin-assets" <<'NODE'
const { createHash } = require('node:crypto');
const { cpSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const [rootDir, stateFile, assetRoot] = process.argv.slice(2);
const pluginId = 'io.enterpriseglue.reference-health';
const bundleRoot = resolve(rootDir, 'packages/plugin-reference/dist/plugin-bundle');
const manifest = JSON.parse(readFileSync(resolve(bundleRoot, 'plugin.yaml'), 'utf8'));
const resources = JSON.parse(readFileSync(resolve(bundleRoot, 'deploy/resources.json'), 'utf8'));
manifest.scope.enablement = 'tenant';
manifest.entitlement = { provider: 'plugin', feature: 'pooled_reference' };
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pluginAssetRoot = resolve(assetRoot, pluginId);
mkdirSync(pluginAssetRoot, { recursive: true });
cpSync(bundleRoot, pluginAssetRoot, { recursive: true });
writeFileSync(resolve(pluginAssetRoot, 'plugin.yaml'), manifestBytes, { mode: 0o644 });
writeFileSync(stateFile, `${JSON.stringify({
  schemaVersion: 1,
  revision: 1,
  plugins: {
    [pluginId]: {
      pluginId,
      version: manifest.metadata.version,
      bundle: `registry.invalid/pooled-reference@sha256:${'1'.repeat(64)}`,
      manifestSha256: sha256(manifestBytes),
      manifest,
      resources,
      grantedPermissions: manifest.permissions.required,
      enabled: true,
    },
  },
}, null, 2)}\n`, { mode: 0o644 });
NODE
KEYCLOAK_TLS_DIR="$tls_dir" ./infra/docker/keycloak/generate-local-tls.sh
chmod 755 "$tls_dir"
chmod 644 "$tls_dir/ca.crt" "$tls_dir/server.crt" "$tls_dir/server.key"

echo "[pooled-tenancy-e2e] Starting disposable pooled stack ($project_name)."
run_compose up --build -d --wait db backend frontend frontend-tls keycloak camunda-mock eg-plugin-io-enterpriseglue-reference-health

curl --fail --silent --show-error --cacert "$tls_dir/ca.crt" "https://localhost:${tls_frontend_port}/login" >/dev/null
curl --fail --silent --show-error --cacert "$tls_dir/ca.crt" \
  "https://localhost:${keycloak_port}/realms/enterpriseglue-local/.well-known/openid-configuration" >/dev/null

LOCAL_SAML_ISSUER_URL="https://localhost:${keycloak_port}/realms/enterpriseglue-local" \
LOCAL_SAML_CA_FILE="$tls_dir/ca.crt" \
LOCAL_SAML_SIGNING_CERT_FILE="$identity_secret_dir/keycloak-saml-signing.crt" \
  "$root_dir/scripts/prepare-local-keycloak-saml-certificate.sh"
chmod 644 "$identity_secret_dir/keycloak-saml-signing.crt"
chmod 711 "$identity_secret_dir"
run_compose exec -T backend node -e "require('node:fs').accessSync('/etc/enterpriseglue/local-identity-secrets/keycloak-saml-signing.crt')"

run_compose exec -T backend node - <<'NODE' > "$artifact_dir/database-isolation.json"
const { Client } = require('pg');
(async () => {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
  });
  await client.connect();
  const role = await client.query('SELECT current_user AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = current_user');
  const policies = await client.query("SELECT count(*)::int AS forced_tenant_policy_tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'main' AND c.relrowsecurity AND c.relforcerowsecurity");
  process.stdout.write(`${JSON.stringify({ ...role.rows[0], ...policies.rows[0] }, null, 2)}\n`);
  await client.end();
})().catch((error) => { console.error(error); process.exit(1); });
NODE

common_env=(
  POOLED_TENANCY_E2E=true
  POOLED_TENANCY_ADMIN_EMAIL="$(awk -F= '$1 == "POOLED_TENANCY_ADMIN_EMAIL" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_ADMIN_PASSWORD="$(awk -F= '$1 == "POOLED_TENANCY_ADMIN_PASSWORD" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_POSTGRES_HOST=127.0.0.1
  POOLED_TENANCY_POSTGRES_PORT="$postgres_port"
  POOLED_TENANCY_POSTGRES_USER="$(awk -F= '$1 == "POOLED_TENANCY_POSTGRES_APP_USER" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_POSTGRES_PASSWORD="$(awk -F= '$1 == "POOLED_TENANCY_POSTGRES_APP_PASSWORD" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_POSTGRES_DATABASE="$(awk -F= '$1 == "POOLED_TENANCY_POSTGRES_APP_DATABASE" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_OIDC_ISSUER_URL="https://localhost:${keycloak_port}/realms/enterpriseglue-local"
  POOLED_TENANCY_OIDC_CLIENT_SECRET="$(awk -F= '$1 == "POOLED_TENANCY_OIDC_CLIENT_SECRET" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_ELIGIBILITY_PRIVATE_KEY_FILE="$(awk -F= '$1 == "POOLED_TENANCY_ELIGIBILITY_PRIVATE_KEY_FILE" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_ELIGIBILITY_ISSUER="$(awk -F= '$1 == "EG_TENANT_APP_ELIGIBILITY_ISSUER" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_ELIGIBILITY_AUDIENCE="$(awk -F= '$1 == "EG_TENANT_APP_ELIGIBILITY_AUDIENCE" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  POOLED_TENANCY_REFERENCE_PLUGIN_DATA_DIR="$(awk -F= '$1 == "POOLED_TENANCY_REFERENCE_PLUGIN_DATA_DIR" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  PLAYWRIGHT_BASE_URL="https://localhost:${tls_frontend_port}"
  PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true
  PLAYWRIGHT_WORKERS=1
  PLAYWRIGHT_OUTPUT_DIR="$playwright_output_dir"
  MANUAL_UI_SCREENSHOT_DIR="$playwright_output_dir/ui-evidence/standard"
  E2E_SEED_USER=false
  LOCAL_IDENTITY_SECRET_DIR="$identity_secret_dir"
)

echo '[pooled-tenancy-e2e] Running organization discovery plus segregated OIDC, SAML, and LDAP tenant journeys.'
EG_LDAP_TEST_DOCKER_NETWORK="${project_name}_enterpriseglue-network" \
LOCAL_LDAP_DIRECTORY_HOST=openldap \
LOCAL_LDAP_DIRECTORY_PORT=636 \
  "$root_dir/scripts/run-ldap-protocol-mock.sh" \
  env "${common_env[@]}" pnpm exec playwright test \
    test/e2e/pooled-tenancy-segregated-sso.spec.ts \
    --config test/e2e/playwright.config.ts \
  2>&1 | tee "$artifact_dir/pooled-tenancy-segregated-sso.log"

node - "$artifact_dir/summary.txt" <<'NODE'
const { writeFileSync } = require('node:fs');
writeFileSync(process.argv[2], [
  'status=passed',
  'mode=pooled',
  'database=postgres-restricted-role-force-rls',
  'tenants=alpha-oidc,bravo-saml,charlie-ldap',
  'assertions=organization-finder,workspace-fallback,tenant-admin-ui,tenant-picker,keyboard-focus,responsive-reflow,200-percent-zoom,verified-email-routing,discovery-domain-isolation,privacy-preserving-email-fallback,provider-discovery-isolation,tenant-admin-provider-isolation,tenant-secret-write-only,tenant-secret-cross-tenant-denial,tenant-secret-rotation,tenant-secret-availability,broker-backed-oidc-saml-ldap-login,session-tenant-binding,cross-tenant-denial,signed-tenant-plugin-eligibility,distinct-tenant-eligibility,eligibility-revocation,tenant-app-member-request,tenant-app-admin-approval,tenant-app-sibling-isolation,tenant-app-deactivation,tenant-app-frontend-bootstrap,actual-plugin-gateway,plugin-storage,plugin-schedule-delivery,plugin-event-delivery,plugin-event-revocation,plugin-host-owned-route-denial,plugin-data-retention,immediate-membership-removal',
  'plugin_evidence=real-reference-sidecar-with-exactly-once-schedule-and-event-receipts',
  'ui_evidence=deterministic-desktop-responsive-and-zoom-screenshots',
  'identity_evidence=disposable-keycloak-openldap-and-private-tenant-secret-broker-emulators',
  'credentials=ephemeral-and-not-retained',
  '',
].join('\n'));
NODE

echo '[pooled-tenancy-e2e] Passed; diagnostics are retained and the disposable stack will now be removed.'
