# Docker Compose Layout

Canonical Docker Compose files live in this directory to keep repository root clean and make environment layering explicit.

The optional authorization config-bundle override is `docker-compose.config-bundle.yml`. It mounts a JSON payload read-only for the backend bootstrap service and keeps the secret directory separate. Startup readiness/reconciliation behavior remains tracked in [Deploy Authorization Configuration](../../../docs/how-to/deploy-authorization-config.md).

## Files

- `docker-compose.yml` - development base stack (Postgres default)
- `docker-compose.mysql.yml` - MySQL development overlay
- `docker-compose.mssql.yml` - SQL Server development overlay
- `docker-compose.oracle.yml` - Oracle development/production overlay
- `docker-compose.spanner.yml` - Spanner development overlay
- `docker-compose.backend-expose.yml` - optional backend host-port publish overlay
- `docker-compose.keycloak.yml` - disposable local Keycloak realm for OIDC protocol rehearsal
- `docker-compose.keycloak-tls.yml` - opt-in local-CA overlay for an HTTPS OIDC rehearsal
- `docker-compose.keycloak-saml.yml` - opt-in file-reference secret mount for the HTTPS Keycloak SAML and disposable LDAPS browser rehearsals
- `docker-compose.identity-protocol-rehearsal.yml` - test-only production-image override for the disposable OIDC, Entra-compatible OIDC, SAML, and LDAP rehearsal
- `docker-compose.ci.yml` - CI-specific overrides
- `docker-compose.prod.yml` - production base stack
- `docker-compose.images.yml` - published-image deployment overlay
- `docker-compose.config-bundle.yml` - optional read-only configuration-bundle and separate secret-directory mount

## Invocation convention

Always call Docker Compose from repository root with:

- `--project-directory .`
- one or more `-f infra/docker/compose/<file>.yml` arguments

This keeps path resolution stable for build contexts, env-file references, and volume mounts across local, CI, and release workflows.

Wrapper scripts may pass an absolute project directory (`--project-directory "$ROOT_DIR"`) and quoted compose file paths; that is equivalent and preferred inside scripted automation.
# Native Plugin Manager

The optional native manager uses the same OSS installer and lifecycle engine as the CLI. Production
customers use the source-free deployment kit built by
`scripts/build-plugin-compose-deployment-kit.mjs`; it contains the standalone self-host Compose
file, this overlay, CDN routing templates, immutable image coordinates, a component checksum
manifest, and deployment doctors. No Git checkout or local image build is required.

For repository-local development, put the manager configuration, a random workload token, public
trust policy, and optional registry configuration in a deployment-owned directory. Supply an
immutable published manager image and select exactly one profile:

```bash
export EG_PLUGIN_MANAGER_CONFIG_DIRECTORY="$PWD/.local/plugin-manager"
export EG_PLUGIN_MANAGER_ID=enterpriseglue-plugin-manager
export EG_PLUGIN_MANAGER_IMAGE=ghcr.io/enterpriseglue/plugin-manager@sha256:<digest>
docker compose \
  -f infra/docker/compose/docker-compose.prod.yml \
  -f infra/docker/compose/docker-compose.plugin-manager.yml \
  --profile plugins-planner up -d
```

`plugins-planner` verifies and renders a reviewable plan but has no Docker socket.
`plugins-managed` additionally mounts the Docker socket and must be an explicit operator choice;
set `DOCKER_GID` to the socket group. The legacy `plugin-manager-planner` and
`plugin-manager-managed` profile names remain aliases. Never run both modes together.

Managed production Compose must set `EG_PLUGIN_MANAGER_STATE_SOURCE` and
`EG_PLUGIN_MANAGER_STATE_DIRECTORY` to the same absolute host path. This makes the installer state,
generated overlay, staged frontend assets, and lifecycle receipts durable and host-visible to the
Docker daemon. The named `plugin_manager_state` volume remains the compatibility default for older
planner deployments. The manager has no published port, and registry credentials are mounted only
into the manager workload.
