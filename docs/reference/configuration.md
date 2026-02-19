# Configuration Reference

Summary: Environment variables for backend and frontend configuration.

Audience: Developers and architects.

## Backend Configuration
Primary sources:
- `.env.docker` (Docker Compose)
- `backend/.env` (host-based runs)

### Core Settings
- `API_PORT`: backend port (default 8787)
- `BACKEND_HOST_PORT`: backend host port (Docker dev)
- `EXPOSE_BACKEND`: publish backend on host in Docker dev (`true`/`false`)
- `FRONTEND_HOST_PORT`: frontend host port (Docker dev/prod)
- `DATABASE_TYPE`: `postgres | oracle | mssql | spanner | mysql`
- `FRONTEND_URL`: frontend origin for auth links

### Database (Postgres default)
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`
- `POSTGRES_SCHEMA` (must be non-public)
- `POSTGRES_SSL`

### Enterprise Schema
- `ENTERPRISE_SCHEMA` (must be non-public and distinct from `POSTGRES_SCHEMA`)

### Auth & Admin Bootstrap
- `JWT_SECRET`
- `JWT_ACCESS_TOKEN_EXPIRES`
- `JWT_REFRESH_TOKEN_EXPIRES`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### Git & Encryption
- `GIT_REPOS_PATH`
- `GIT_DEFAULT_BRANCH`
- `ENCRYPTION_KEY`

### Database Compatibility (TypeORM Adapters)
Database support is provided via TypeORM adapters and driver packages:
- **Postgres**: `pg`
- **Oracle**: `oracledb` (requires Oracle Instant Client)
- **SQL Server**: `mssql`
- **Spanner**: `@google-cloud/spanner`
- **MySQL**: `mysql2`

See `backend/.env.example` for detailed per-database settings.

## Frontend Configuration
Primary sources:
- `frontend/.env.local` or `frontend/.env`
- `.env.docker` (Docker Compose)
- `.env.production` (Docker Compose production)

### Core Settings
- `API_BASE_URL`: preferred root env alias in Docker compose files
- `VITE_API_BASE_URL`: frontend runtime variable consumed by browser code (Vite-exposed)

In Docker compose, `API_BASE_URL` is mapped to `VITE_API_BASE_URL` for frontend runtime.
For production same-origin routing through Nginx, leave `API_BASE_URL` empty.

### Feature Flags
The UI is gated by `VITE_FEATURE_*` flags (see `frontend/.env.example`), such as:
- `VITE_FEATURE_VOYAGER`
- `VITE_FEATURE_STARBASE`
- `VITE_FEATURE_MISSION_CONTROL`
- `VITE_FEATURE_ENGINES`

## Related Files
- `backend/.env.example`
- `frontend/.env.example`
- `.env.docker.example`
- `backend/src/shared/config/index.ts`
