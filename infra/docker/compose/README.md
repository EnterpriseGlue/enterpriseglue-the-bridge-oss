# Docker Compose Layout

Canonical Docker Compose files live in this directory to keep repository root clean and make environment layering explicit.

## Files

- `docker-compose.yml` - development base stack (Postgres default)
- `docker-compose.mysql.yml` - MySQL development overlay
- `docker-compose.mssql.yml` - SQL Server development overlay
- `docker-compose.oracle.yml` - Oracle development/production overlay
- `docker-compose.spanner.yml` - Spanner development overlay
- `docker-compose.backend-expose.yml` - optional backend host-port publish overlay
- `docker-compose.ci.yml` - CI-specific overrides
- `docker-compose.prod.yml` - production base stack
- `docker-compose.images.yml` - published-image deployment overlay

## Invocation convention

Always call Docker Compose from repository root with:

- `--project-directory .`
- one or more `-f infra/docker/compose/<file>.yml` arguments

This keeps path resolution stable for build contexts, env-file references, and volume mounts across local, CI, and release workflows.
