# Enterprise Backend Plugin Database API

Summary: Use the portable TypeORM command boundary supplied to EnterpriseGlue
backend plugins.

Audience: OSS and Enterprise Edition plugin developers.

## Supported Contract

`EnterpriseBackendContext.database` is the canonical database interface for
plugins. It is available for PostgreSQL, Oracle, MySQL, SQL Server, and
Spanner and exposes the configured adapter, the initialized TypeORM data
source, and a transaction boundary.

```ts
async migrateEnterpriseDatabase(ctx) {
  const dataSource = await ctx.database.getDataSource<DataSource>();

  await ctx.database.transaction(async (manager) => {
    const entityManager = manager as EntityManager;
    await entityManager.getRepository(EnterpriseEntity).save(value);
  });
}
```

Plugin code should use TypeORM repositories, query builders, and migrations.
Database-specific DDL belongs in an explicitly adapter-qualified TypeORM
migration with tests for every supported adapter.

## Deprecated Raw Pool

`EnterpriseBackendContext.connectionPool` remains temporarily available for
existing PostgreSQL and Oracle plugins. It is deprecated because its SQL,
placeholder, and result semantics are driver-specific. It fails explicitly on
MySQL, SQL Server, and Spanner rather than pretending those adapters are
portable.

Do not add new calls to `connectionPool.query()` or `getNativePool()`. Move
existing plugin code to `ctx.database` before removing the compatibility field
in the next plugin-API major compatibility window.

## Verification

Run:

```bash
pnpm run guard:plugin-api:current
pnpm --dir backend exec vitest run \
  __tests__/services/enterpriseDatabaseContext.test.ts \
  __tests__/contract/backend-host-conformance.test.ts \
  __tests__/contract/api-surface-snapshot.test.ts \
  --config vitest.config.ts
```

The adapter canary executes the same TypeORM boundary for all five database
types without constructing a raw driver pool.
