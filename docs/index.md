# EnterpriseGlue Documentation (Developer/Architect MVP)

Summary: Technical documentation for developers and architects evaluating or
operating the platform.

Audience: Developers and architects.

## Scope (Current MVP)
- Technical deployment (Docker-first + OpenShift overlays).
- Configuration reference for backend and frontend.
- Platform module overview (Voyager, Starbase, Mission Control, etc.).
- Links to existing technical references.

## Quickstart
- [Docker Quickstart](how-to/getting-started-docker.md)

## Deployment
- [Docker Compose Deployment](how-to/deploy-docker.md)
- [OpenShift Deployment](how-to/deploy-openshift.md)
- [Deployment Runbook](how-to/deployment-runbook.md)

## Configuration
- [Configuration Reference](reference/configuration.md)
- [Configuration Matrix](reference/configuration-matrix.md)
- [Auth and SSO Setup](how-to/auth-sso.md)

## Architecture
- [Architecture Overview](architecture/00-architecture-overview.md)
- [Logical Architecture](architecture/02-oss-logical-architecture.md)
- [Authorization and Access Control](architecture/09-oss-authorization-access-control-model.md)

## Database
- [Database Architecture Overview](reference/database-architecture.md)
- [Non-Postgres Database Setup](how-to/database-non-postgres.md)

## Operations
- [Observability and Logs](reference/observability-logs.md)
- [Troubleshooting](how-to/troubleshooting.md)

## Security
- [Security Hardening Checklist](reference/security-hardening.md)

## Existing Technical References
- [Database Architecture](../backend/src/shared/db/README.md)
- [Database Migrations](../backend/docs/DATABASE-MIGRATIONS.md)
- [Error Handling Guide](../backend/src/shared/middleware/README.md)
- [Frontend Shared Components](../frontend/src/features/shared/components/README.md)
- [Frontend Modal System](../frontend/src/shared/components/modals/README.md)
