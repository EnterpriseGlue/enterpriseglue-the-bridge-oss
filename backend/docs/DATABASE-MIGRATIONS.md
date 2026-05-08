# Database Migrations Guide

This document explains how to work with database schema changes and migrations in the EnterpriseGlue backend.

## Overview

We use **TypeORM** for database schema management and migrations. All tables are defined in the `main` PostgreSQL schema via TypeORM entities.

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

Edit the appropriate entity file in `src/db/entities/`:

- `User.ts`, `RefreshToken.ts` - Authentication
- `AuditLog.ts` - Audit logs
- `Project.ts`, `File.ts`, `Folder.ts`, `Version.ts` - Starbase
- `Branch.ts`, `Commit.ts`, `WorkingFile.ts` - Versioning
- `Tenant.ts`, `PlatformSettings.ts`, `Invitation.ts` - Platform
- `Engine.ts`, `SavedFilter.ts` - Mission Control
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
npm run build                    # Build first to compile entities
npm run db:migration:generate    # Generate migration SQL
```

Review the generated SQL in the migrations output.

### 3. Test Locally

```bash
./scripts/deploy-localhost.sh
```

Migrations run automatically on backend startup.

### 4. Commit Changes

Commit both the entity changes and any migration files.

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
│   ├── Engine.ts                   # Camunda engines
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

**How it works:**
1. Docker build compiles TypeScript (including entities)
2. Migrations run automatically when the container starts via `run-migrations.ts`

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
