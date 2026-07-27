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
- [Deploy Authorization Configuration (Target)](how-to/deploy-authorization-config.md)

## Configuration
- [Configuration Reference](reference/configuration.md)
- [Configuration Matrix](reference/configuration-matrix.md)
- [Customer Sidecar Backstop Adapter API](reference/customer-sidecar-backstop-adapter-api.md)
- [Auth and SSO Setup](how-to/auth-sso.md)
- [Configure Authorization, Identity, and Engines (Target)](how-to/configure-authorization-and-engines.md)
- [Enable Mirrored Camunda 7 or Operaton Authorization Backstop](how-to/enable-mirrored-engine-backstop.md)
- [Customer Sidecar Readiness Runbook](how-to/customer-sidecar-readiness-runbook.md)
- [Configure Dedicated and Shared Engine Tenancy](how-to/configure-engine-tenancy.md)
- [Diagnose Engine Tenant Resolution](how-to/diagnose-engine-tenant-resolution.md)
- [Migrate Existing Engines to Explicit Tenancy](how-to/migrate-existing-engines-to-explicit-tenancy.md)
- [Upgrade to Explicit Engine Tenancy](how-to/upgrade-engine-tenancy.md)
- [Migrate Camunda 7 Native Grants](how-to/migrate-camunda7-native-grants.md)

## Architecture
- [Architecture Overview](architecture/00-architecture-overview.md)
- [Logical Architecture](architecture/02-oss-logical-architecture.md)
- [Authorization and Access Control](architecture/09-oss-authorization-access-control-model.md)
- [JSON-Driven Authorization and Engine Registration](architecture/11-json-driven-authz-and-engine-registration.md)
- [Centralized and Decentralized Engine Tenancy Implementation Plan](architecture/12-engine-tenancy-and-external-provisioning-plan.md)
- [Camunda 7 Native Grant Migration Plan](architecture/13-camunda-7-native-grant-migration-plan.md)
- [ADR 0001: Limit Default Tenant Fallback to Provisioning](architecture/decisions/0001-default-tenant-provisioning-fallback.md)
- [ADR 0002: Fail Closed for Shared-Engine Tenant Resolution](architecture/decisions/0002-shared-engine-fail-closed-resolution.md)

## Development and Verification
- [Mirrored Engine Backstop Developer Guide](developer/mirrored-engine-backstop.md)
- [Customer Sidecar Backstop Test Report](development/customer-sidecar-backstop-test-report.md)
- [Identity Protocol, Entra Compatibility, and LDAP Test Harness](how-to/ldap-protocol-test-harness.md)

## Database
- [Database Architecture Overview](reference/database-architecture.md)
- [Engine Tenancy Data Model](reference/engine-tenancy-data-model.md)
- [Engine Tenancy and Provisioning API](reference/engine-tenancy-and-provisioning-api.md)
- [Engine Tenancy Compatibility and Deprecation](reference/engine-tenancy-compatibility-and-deprecation.md)
- [Provision Engines Externally](how-to/provision-engines-externally.md)
- [Test Engine Tenancy and Fine-Grained Access Control](development/testing-engine-tenancy-and-access-control.md)
- [Qualify Engine Tenancy on Every Supported Database](development/engine-tenancy-database-qualification.md)
- [Engine Tenancy Functional Test Report](development/engine-tenancy-functional-test-report.md)
- [Engine Tenancy Documentation Review Checklist](development/engine-tenancy-documentation-review-checklist.md)
- [Develop and Test Camunda 7 Native-Grant Migration](development/camunda7-native-grant-migration.md)
- [Non-Postgres Database Setup](how-to/database-non-postgres.md)
- [Camunda 7 Native-Grant Migration API](reference/camunda7-native-grant-migration-api.md)

## Operations
- [Observability and Logs](reference/observability-logs.md)
- [Troubleshooting](how-to/troubleshooting.md)

## Release Notes
- [Engine Tenancy](releases/engine-tenancy.md)

## Security
- [Security Hardening Checklist](reference/security-hardening.md)

## Existing Technical References
- [Database Architecture](../packages/shared/src/db/README.md)
- [Database Migrations](../backend/docs/DATABASE-MIGRATIONS.md)
- [Error Handling Guide](../packages/shared/src/middleware/README.md)
- [Frontend Shared Components](../packages/frontend-host/src/features/shared/components/README.md)
- [Frontend Modal System](../packages/frontend-host/src/shared/components/modals/README.md)
