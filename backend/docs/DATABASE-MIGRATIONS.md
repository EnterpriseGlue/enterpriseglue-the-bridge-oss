# Database Migrations Guide

This document explains how to work with database schema changes and migrations in the EnterpriseGlue backend.

## Overview

We use **TypeORM** for database schema management and migrations. Canonical
entities use the logical `main` schema and are normalized by the PostgreSQL,
MySQL, SQL Server, Oracle, and Spanner adapters.

## Available Commands

| Command | When to Use |
|---------|-------------|
| `pnpm run build` | **Regular builds & deployments** - Compiles TypeScript |
| `pnpm run db:migration:generate` | Generate new migration after entity changes |
| `pnpm run db:migration:run` | Run pending migrations |
| `pnpm run db:migration:revert` | Revert last migration |
| `pnpm run db:schema:sync` | Sync schema directly (dev only) |

## Workflow for Schema Changes

### 1. Modify Entity Definition

Edit the appropriate entity file in
`packages/shared/src/infrastructure/persistence/entities/`:

- `User.ts`, `RefreshToken.ts` - Authentication
- `AuditLog.ts` - Audit logs
- `Project.ts`, `File.ts`, `Folder.ts`, `Version.ts` - Starbase
- `Branch.ts`, `Commit.ts`, `WorkingFile.ts` - Versioning
- `PlatformSettings.ts`, `Invitation.ts` - Platform
- `Engine.ts`, `SavedFilter.ts` - Mission Control
- `EngineTenantMapping.ts`, `RuntimeResource.ts` - engine tenancy resolution
- `Tenant.ts`, `TenantDomain.ts`, `TenantDiscoveryDomain.ts`,
  `TenantDiscoveryChallenge.ts`, `TenantLoginPolicy.ts` - native SaaS tenancy
- `GitRepository.ts`, `GitCredential.ts` - Git integration
- `EngineDeployment.ts` - Engine deployments
- `Batch.ts` - Batch operations

**Important:** Always use the `main` schema in entity definitions:

```typescript
import { Entity, Column } from 'typeorm';
import { AppBaseEntity } from './BaseEntity.js';

@Entity({ name: 'my_new_table', schema: 'main' })
export class MyNewTable extends AppBaseEntity {
  @Column({ type: 'text' })
  name!: string;
  
  @Column({ name: 'created_at', type: 'bigint' })
  createdAt!: number;
}
```

### 2. Generate Migration

```bash
cd backend
pnpm run build                    # Build first to compile entities
pnpm run db:migration:generate    # Generate migration SQL
```

Review the generated SQL in the migrations output.

### 3. Test Locally

```bash
./scripts/deploy-localhost.sh
```

Migrations run automatically on backend startup.

### 4. Commit Changes

Commit both the entity changes and any migration files.

Canonical migrations live in `packages/shared/src/db/migrations`. Add a
one-line re-export under
`packages/shared/src/infrastructure/persistence/migrations` so both supported
import paths execute the same class. Register every new entity in all five
database adapters and extend `adapterEntityRegistry.test.ts`.

## Deployment Behavior

- **Local development:** Migrations run automatically on backend startup
- **CI/CD:** Use `npm run build` - no interactive prompts
- **Production:** Migrations run on application startup via `run-migrations.ts`

## Entity Files Structure

```
backend/
├── src/db/entities/
│   ├── index.ts                    # Re-exports all entities
│   ├── BaseEntity.ts               # Base entity with ID generation
│   ├── User.ts                     # Authentication
│   ├── RefreshToken.ts             # Auth tokens
│   ├── AuditLog.ts                 # Audit logging
│   ├── Project.ts                  # Core project table
│   ├── File.ts                     # Files
│   ├── Folder.ts                   # Folders
│   ├── Version.ts                  # File versions
│   ├── Branch.ts                   # VCS branches
│   ├── Commit.ts                   # VCS commits
│   ├── Engine.ts                   # BPMN engine connection and topology
│   ├── EngineTenantMapping.ts      # Shared-engine tenant mappings
│   ├── RuntimeResource.ts          # Runtime authorization inventory
│   ├── EngineDeployment.ts         # Deployment tracking
│   └── ... (48+ entities)
└── src/db/
    ├── data-source.ts              # TypeORM DataSource config
    └── run-migrations.ts           # Migration runner
```

## Docker Deployment

The Docker build compiles TypeScript:

```dockerfile
# Dockerfile
RUN pnpm run build
```

### Isolated Docker PostgreSQL migration baseline

`test/integration/postgres-schema-migration.test.ts` intentionally moves and
drops schemas. When validating it against the local Docker stack, create a
disposable database and pass it through the `MIGRATION_TEST_POSTGRES_*`
overrides; never point the suite at the active application database. The test
database can be created and removed with `psql` in the running `db` container.

The local deployment helper's `.env.docker` supplies the PostgreSQL credentials
and port. Use a throwaway database name, run the suite, then remove it even if
the test fails:

```bash
set -a; source .env.docker; set +a
TEST_DB=authz_migration_validation
DB_CONTAINER=feat-sso-engine-assignments-db-1
docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE DATABASE $TEST_DB"
MIGRATION_TEST_POSTGRES_HOST=127.0.0.1 \
MIGRATION_TEST_POSTGRES_PORT=55433 \
MIGRATION_TEST_POSTGRES_USER="$POSTGRES_USER" \
MIGRATION_TEST_POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
MIGRATION_TEST_POSTGRES_DATABASE="$TEST_DB" \
  pnpm --dir backend exec vitest run test/integration/postgres-schema-migration.test.ts \
  --config vitest.config.ts
docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)"
```

**How it works:**
1. Docker build compiles TypeScript (including entities)
2. Migrations run automatically when the container starts via `run-migrations.ts`

### Engine tenancy foundation migration

Migration `1700000000096-add-engine-tenancy-foundation` adds explicit
dedicated/shared engine metadata, the `engine_tenant_mappings` table, and
runtime-resource resolution evidence.

The upgrade classification is deliberately fail-closed:

- an existing engine with `tenant_id` is `dedicated` and `ready`;
- an existing engine without `tenant_id` is `dedicated` and
  `migration_required`;
- an existing runtime resource with `tenant_id` is `resolved`;
- an existing runtime resource without `tenant_id` is `unmapped`.

Do not change this migration to attach null rows to the default tenant or infer
shared topology from `runtime_access_scope`. A later classification preview
must produce evidence before unresolved rows become ready.

For the operator sequence, supported-adapter verification, compatibility
window, rollback conditions, and retained evidence, use
[Upgrade to Explicit Engine Tenancy](../../docs/how-to/upgrade-engine-tenancy.md).

Focused validation:

```bash
pnpm --dir backend exec vitest run \
  __tests__/shared/db/canonicalAuthzSchemaInvariants.test.ts \
  __tests__/shared/db/adapterEntityRegistry.test.ts \
  __tests__/shared/db/persistenceMigrationBridge.test.ts \
  --config vitest.config.ts
```

### Native SaaS tenancy migrations

The native tenancy upgrade from `v0.16.2` is ordered:

1. `1700000000124-add-native-saas-tenancy` creates canonical tenant,
   routing/discovery-domain, discovery-challenge, and login-policy storage and
   adds tenant bindings to authentication records.
2. `1700000000125-backfill-native-tenant-ownership` assigns the explicit
   tenant-owned table allowlist to the canonical default tenant. This data
   classification is intentionally irreversible.
3. `1700000000126-add-postgres-tenant-rls` installs the PostgreSQL forced-RLS
   policies used only by native `pooled` mode.

Register the portable entities in every adapter so `single` mode continues to
work on PostgreSQL, MySQL, SQL Server, Oracle, and Spanner. Do not enable
`pooled` mode outside PostgreSQL. Upgrade and verify in `single` mode before
enabling RLS-backed pooled routing; preserve a pre-upgrade backup because down
migrations cannot reconstruct the legacy ownership classification or retain
removed pooled records. The complete sequence and restricted-role checks are
in [Native SaaS Tenancy](../../docs/architecture/11-native-saas-tenancy.md#upgrade-from-0162).

## Configuration

The database connection is configured via environment variables:

```env
POSTGRES_HOST=your-host
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-password
POSTGRES_DATABASE=postgres
POSTGRES_SCHEMA=main
POSTGRES_SSL=true
```

The connection is configured in `src/db/data-source.ts`.

## Troubleshooting

### Migration not running

1. Ensure `run-migrations.ts` is called on startup
2. Check DataSource is initialized correctly
3. Verify database connection settings

### Entity changes not reflected

1. Run `pnpm run build` first to compile entities
2. Then run `pnpm run db:migration:generate`
3. Run `pnpm run db:schema:sync` in development to force sync

### Schema mismatch errors

1. Verify all entities use `schema: 'main'`
2. Check migration SQL references correct schema
