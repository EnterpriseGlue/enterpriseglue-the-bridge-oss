# Non-Postgres Database Setup

Summary: Configure EnterpriseGlue with Oracle, SQL Server, Spanner, or MySQL.

Audience: Developers and architects.

## Recommended: One-click Docker workflow

Use `--db` with the dev launcher:

```bash
npm run dev -- --db mysql
npm run dev -- --db mssql
npm run dev -- --db oracle
npm run dev -- --db spanner
```

What the launcher does automatically:
1. Creates `.local/docker/env/docker.<db>.env` from `infra/docker/env/examples/docker.<db>.env.example` if missing.
2. Runs `scripts/db-preflight.sh` to validate required environment variables.
3. Installs a missing DB driver package (`mysql2`, `mssql`, `oracledb`, `@google-cloud/spanner`).
4. Loads matching compose overlay from `infra/docker/compose/` (`docker-compose.<db>.yml`) and starts the stack.

Stop the selected stack:

```bash
npm run down -- --db mysql
```

## Host-based backend workflow (without Docker DB overlays)

For direct backend runs against an existing database:
1. Configure `backend/.env` with `DATABASE_TYPE` + database-specific variables.
2. Run preflight checks manually:
   ```bash
   bash ./scripts/db-preflight.sh --env-file ./backend/.env --mode localhost --install-drivers true
   ```
3. Start backend:
   ```bash
   npm --prefix backend run start
   ```

For production-style localhost deployment script:

```bash
bash ./scripts/deploy-localhost.sh
```

The deploy script now runs the same DB preflight checks before build/start.

## Oracle
- Env vars: `ORACLE_HOST`, `ORACLE_PORT`, `ORACLE_USER`, `ORACLE_PASSWORD`,
  `ORACLE_SERVICE_NAME` (or `ORACLE_SID`), `ORACLE_SCHEMA`.
- Driver: `oracledb` (requires Oracle Instant Client).
- Important: if Oracle Instant Client is missing or not loadable, preflight fails with explicit setup guidance.

## SQL Server
- Env vars: `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`,
  `MSSQL_DATABASE`, `MSSQL_SCHEMA`, `MSSQL_ENCRYPT`, `MSSQL_TRUST_SERVER_CERTIFICATE`.
- Driver: `mssql`.

## Google Spanner
- Env vars: `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, `SPANNER_DATABASE_ID`.
- Driver: `@google-cloud/spanner`.
- Set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON path.

## MySQL
- Env vars: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
  `MYSQL_DATABASE`.
- Driver: `mysql2`.

## Verify
- Backend logs print the active database type on startup.
- Confirm schema settings are valid for your selected database type.
- Hit health endpoint after startup:
  - `http://localhost:8787/health` (host runs)
  - or proxied via frontend origin in Docker if backend is internal-only.

## Reference
- `backend/.env.example`
- `infra/docker/env/examples/docker.<db>.env.example` templates
- `scripts/db-preflight.sh`
