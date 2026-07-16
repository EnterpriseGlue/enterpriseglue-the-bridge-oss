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
