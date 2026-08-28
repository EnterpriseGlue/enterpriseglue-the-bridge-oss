# Database Architecture

## Overview

The database layer uses **TypeORM** for type-safe, database-agnostic queries. The application supports **PostgreSQL, Oracle, MySQL, SQL Server, and Spanner** with all tables in the configured schema.

## File Structure

```
db/
├── data-source.ts      # TypeORM DataSource configuration
├── db-pool.ts          # Deprecated PostgreSQL/Oracle raw-pool compatibility
├── run-migrations.ts   # Migration runner + data seeding
├── bootstrap.ts        # Initial data seeding
├── adapters/           # Database-specific adapters
│   ├── DatabaseAdapter.ts    # Abstract adapter interface
│   ├── PostgresAdapter.ts    # PostgreSQL implementation
│   ├── OracleAdapter.ts      # Oracle implementation
│   ├── MySQLAdapter.ts       # MySQL implementation
│   ├── SqlServerAdapter.ts   # SQL Server implementation
│   ├── SpannerAdapter.ts     # Google Spanner implementation
│   └── QueryHelpers.ts       # Database-agnostic query utilities
└── entities/           # TypeORM entity definitions
    ├── index.ts                    # Re-exports all entities
    ├── BaseEntity.ts               # Base entity with ID generation
    ├── User.ts                     # Users
    ├── RefreshToken.ts             # Auth tokens
    ├── Project.ts                  # Projects
    ├── File.ts                     # Files
    ├── Folder.ts                   # Folders
    ├── Version.ts                  # File versions
    ├── Comment.ts                  # Comments
    ├── Branch.ts                   # VCS branches
    ├── Commit.ts                   # VCS commits
    ├── Engine.ts                   # Camunda engines
    ├── EngineDeployment.ts         # Deployment tracking
    └── ... (48+ entities total)
```

## Database Organization

### Multi-Database Support
- **Purpose:** All application data in a single database instance
- **Supported:** PostgreSQL, Oracle, MySQL, SQL Server, Spanner
- **Native tenancy:** All adapters support `EG_TENANCY_MODE=single`; native
  `pooled` mode is PostgreSQL-only because it requires forced row-level
  security and a restricted application role
- **Schema:** All tables in the configured schema (default: `main`)
- **Connection:** `getDataSource()` for repositories/query builders;
  `getConnectionPool()` is a deprecated PostgreSQL/Oracle compatibility path
  and must not be used in application routes/services or new plugins

### Entity Categories
- **Auth:** User, RefreshToken
- **Starbase:** Project, File, Folder, Version, Comment
- **Versioning:** Branch, Commit, WorkingFile, FileSnapshot
- **Platform:** EnvironmentTag, PlatformSettings, Tenant, TenantDomain,
  TenantDiscoveryDomain, TenantDiscoveryChallenge, TenantLoginPolicy,
  TenantRoutingAlias, TenantLifecycleOperation, Invitation
- **Mission Control:** Engine, SavedFilter, EngineHealth
- **Git:** GitRepository, GitCredential, GitDeployment
- **Deployments:** EngineDeployment, EngineDeploymentArtifact

## Usage Examples

### Basic Queries with Repository
```typescript
import { getDataSource } from './db/data-source.js';
import { Project } from './db/entities/Project.js';

const ds = await getDataSource();
const projectRepo = ds.getRepository(Project);

// Find all
const allProjects = await projectRepo.find();

// Find by ID
const project = await projectRepo.findOneBy({ id: '123' });

// Find with conditions
const userProjects = await projectRepo.find({
  where: { ownerId: userId },
  order: { createdAt: 'DESC' }
});
```

### Complex Queries with QueryBuilder
```typescript
import { getDataSource } from './db/data-source.js';
import { Project } from './db/entities/Project.js';
import { addCaseInsensitiveLike } from './db/adapters/index.js';

const ds = await getDataSource();

// QueryBuilder for complex queries
const qb = ds.getRepository(Project)
  .createQueryBuilder('project')
  .leftJoinAndSelect('project.files', 'file')
  .orderBy('project.createdAt', 'DESC')
  .limit(10);

addCaseInsensitiveLike(qb, 'project', 'name', 'search', `%${term}%`);

const projects = await qb.getMany();
```

### Transactions
```typescript
const ds = await getDataSource();

await ds.transaction(async (manager) => {
  await manager.save(Project, newProject);
  await manager.save(File, newFile);
});
```

### Insert and Update
```typescript
const ds = await getDataSource();
const repo = ds.getRepository(Project);

// Insert
const project = await repo.save({
  name: 'New Project',
  ownerId: userId,
  createdAt: Date.now(),
  updatedAt: Date.now()
});

// Update
await repo.update(projectId, { name: 'Updated Name', updatedAt: Date.now() });

// Delete
await repo.delete(projectId);
```

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        server.ts                             │
│                     (on startup)                             │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
                 ┌────────────────┐
                 │run-migrations.ts│  ← Runs TypeORM migrations
                 │                │    + seeds initial data
                 └────────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ data-source  │
                   │  (TypeORM)   │
                   └──────┬───────┘
                          │
                          ▼
                 ┌────────────────┐
                 │   entities/    │  ← Single source of truth
                 │                │
                 │ • User         │
                 │ • Project      │
                 │ • File         │
                 │ • Branch       │
                 │ • Engine       │
                 │ • ...          │
                 └───────┬────────┘
                         │
                         ▼
                 ┌────────────────┐
                 │    routes/     │  ← Use getDataSource()
                 │    services/   │    + repositories
                 └────────────────┘
```

## Migration Strategy

TypeORM handles migrations automatically:

1. **Development:** Migrations run on startup via `run-migrations.ts`
2. **Production:** Same - migrations run automatically on container start
3. **New migrations:** Use `pnpm run db:migration:generate` after entity changes

Native SaaS tenancy is introduced by migrations `1700000000124` through
`1700000000127`. They create the tenant directory and login-policy records,
backfill existing tenant-owned rows to the canonical default tenant, and add
the PostgreSQL RLS backstop used by pooled mode. Migration `1700000000127` adds
the cloud-managed routing-alias registry and secret-free workload lifecycle
receipt ledger. The ownership backfill is not reversible. Upgrade and verify
the database in `single` mode before enabling pooled routing, and retain a
pre-upgrade backup. See
[Database Architecture](../../../../docs/reference/database-architecture.md#native-saas-tenancy-persistence)
and [Native SaaS Tenancy](../../../../docs/architecture/11-native-saas-tenancy.md).

### Available Scripts

```bash
pnpm run db:migration:generate  # Generate migration after entity changes
pnpm run db:migration:run       # Run pending migrations
pnpm run db:migration:revert    # Revert last migration
pnpm run db:schema:sync         # Sync schema (dev only)
```

## Best Practices

1. **Entity Changes:**
   - Update entity file in `entities/`
   - Run `pnpm run db:migration:generate` to create migration
   - Review generated SQL before committing

2. **Queries:**
   - Use TypeORM repositories for simple CRUD
   - Use QueryBuilder for complex joins/conditions
   - Use transactions for multi-table operations

3. **Type Safety:**
   - Entity classes provide TypeScript types
   - Import types from entities, not separate type files

---

## Recent Changes

### 2026-01: TypeORM Migration
- **Migrated from:** Drizzle ORM to TypeORM
- **Reason:** Oracle database support requirement
- **Impact:** All queries now use TypeORM Repository/QueryBuilder patterns
- **Entities:** 48+ TypeORM entities created
- **Migrations:** TypeORM CLI manages schema changes

### 2026-01: Database-Agnostic Refactor
- **Added:** Abstract `ConnectionPool` interface in `db-pool.ts`
- **Added:** Database adapters for PostgreSQL, Oracle, MySQL, SQL Server, Spanner
- **Removed:** PostgreSQL-specific `postgres-client.ts`
- **Updated:** All seed data uses TypeORM `upsert()` instead of raw SQL
- **Config:** Set `DATABASE_TYPE` environment variable to switch databases
