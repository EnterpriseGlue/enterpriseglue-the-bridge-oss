# Contributing to EnterpriseGlue

Thanks for taking the time to contribute!

## Code of Conduct

By participating, you agree to abide by the Code of Conduct. See `CODE_OF_CONDUCT.md`.

## Ways to contribute

- Bug reports and reproduction steps
- Documentation improvements
- Bug fixes
- New features and integrations (please discuss first)

## Where to ask questions

- Use **GitHub Discussions** for questions, troubleshooting, and design discussion.
- Use **GitHub Issues** for actionable bugs and feature requests.

## Development setup

### Prerequisites

- Docker (Docker Desktop recommended)
- Docker Compose plugin (`docker compose`)

Optional (only if running services outside Docker):

- Node.js (LTS recommended)
- npm

### Configure environment

- Docker-first development uses `.local/docker/env/docker.env` (legacy root `.env.docker` is still accepted as fallback).
- If missing, `dev.sh` can bootstrap it from `infra/docker/env/examples/docker.postgres.env.example`.
- The Docker environment runs PostgreSQL 18 in a container and the backend uses PostgreSQL schemas for different logical databases.

### Run locally (Docker-first)

From the repo root:

- `npm run dev`

This starts:

- Backend: http://localhost:8787
- Frontend: http://localhost:5173

To stop:

- `npm run down`

Alternative entrypoints:

- `bash ./dev.sh`
- `bash ./down.sh`

### Resetting your local Docker state

If you change the Postgres major version or want to reset your local database:

- `npm run down -- -v`

### Running services outside Docker (advanced)

If you prefer to run the backend/frontend outside Docker:

- Backend:
  - Copy `backend/.env.example` to `backend/.env` and set required values.
  - `cd backend && npm install`
  - `cd backend && npm run dev`
- Frontend:
  - Copy `frontend/.env.example` to `frontend/.env.local` (or `.env`) and set required values.
  - `cd frontend && npm install`
  - `cd frontend && npm run dev`

Optional: local “production-style” run on the host (advanced):

- `npm run deploy:localhost` (or `bash ./scripts/deploy-localhost.sh`)
  - It builds `backend/dist` and `frontend/dist`, then serves the frontend via `vite preview`.
  - For first-time installs, pass `--first-time` to run migrations before startup.
  - Otherwise, migrations run automatically when the backend starts.
  - See [Localhost Deployment](docs/how-to/deploy-localhost.md).

## Running tests

### First-time test setup

Before running tests for the first time, you need to set up the test database schema:

```bash
# From repo root
cd backend
npm run build:skip-generate
npm run db:schema:sync
```

This creates all database tables in your test database. The test environment (`NODE_ENV=test`) skips migrations by design and uses schema synchronization instead.

### Running tests

```bash
# From repo root
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:e2e            # E2E tests (requires services running)
npm run test:ci             # All tests (unit + integration + e2e)
```

Playwright uses `test/e2e/playwright.config.ts` as the canonical E2E config path.

**Note:** Integration and E2E tests require:
- PostgreSQL running (Docker or local)
- Database schema synced (see above)
- For E2E: Backend and frontend services running

## Running checks

This repo relies on TypeScript and build-time checks.

- Backend typecheck (no emit):
  - `cd backend && npx tsc --noEmit`
- Frontend build (includes typecheck):
  - `cd frontend && npm run build`

Optional API smoke checks (requires a running backend and valid credentials):

- `./scripts/validate-api.sh`

## Pull requests

### Before opening a PR

- Keep PRs focused and small when possible.
- Add or update tests where appropriate.
- Update docs for user-visible changes.

### PR expectations

- Describe the problem and solution.
- Include steps to validate (what you ran locally).
- UI changes should include screenshots.

## Security

If you believe you have found a security vulnerability, do not open a public issue.

See `SECURITY.md` for the preferred reporting process.
