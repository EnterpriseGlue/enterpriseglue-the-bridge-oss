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

For the `pnpm run ...` commands below, also install:

- Node.js 24 (see `package.json` `engines`)
- pnpm 11.0.8 (see `package.json` `packageManager`)

If you have Docker and Compose but not Node.js or pnpm on the host, use the
equivalent `bash ./dev.sh` and `bash ./down.sh` entrypoints instead.

### Configure environment

- Docker-first development uses `.local/docker/env/docker.env` (legacy root `.env.docker` is still accepted as fallback).
- On first run, `dev.sh` creates it from `infra/docker/env/examples/docker.postgres.env.example`. The development defaults work as-is; edit it only when changing ports, credentials, or other settings.
- The Docker environment runs PostgreSQL 18 in a container and the backend uses PostgreSQL schemas for different logical databases.

### Run locally (Docker-first)

From the repo root:

- `pnpm run dev`

This starts:

- Backend: http://localhost:8787
- Frontend: http://localhost:5173

The command stays attached to the terminal. The first run can take several
minutes while images and workspace packages build. Startup is complete when
the backend reports `Database migrations complete`, its `/ready` endpoint
returns HTTP 200, and the frontend loads at http://localhost:5173. The frontend
starts after the backend healthcheck passes. For a bounded readiness check,
run `pnpm run dev --wait --wait-timeout 900`.

To run PostgreSQL and the backend without the bundled frontend:

- `pnpm run dev:backend`

The backend remains available at http://localhost:8787. When connecting a
separately running frontend, set `FRONTEND_URL` in
`.local/docker/env/docker.env` to that frontend's exact origin so credentialed
CORS and authentication redirects stay aligned.

To stop:

- `pnpm run down`

Alternative entrypoints:

- `bash ./dev.sh`
- `bash ./down.sh`

### Resetting your local Docker state

Keep the volume when updating the application: normal startup applies pending
migrations to the existing database. If startup fails, retain the volume and
inspect the backend logs before resetting anything. Compiled upgrades crossing
the credential-idempotency or native-tenancy migrations require the corrected
backend described in #551.

For a disposable development database, changing the Postgres major version or
intentionally resetting state requires deleting the volumes. **This deletes
your local database contents:**

- `pnpm run down -v` (or `bash ./down.sh -v`)

### Running services outside Docker (advanced)

The host backend still needs PostgreSQL. To use only the development Compose
database, run this from the repo root. Create the environment file only if it
does not already exist:

```bash
mkdir -p .local/docker/env
if [ ! -f .local/docker/env/docker.env ]; then
  cp infra/docker/env/examples/docker.postgres.env.example .local/docker/env/docker.env
fi
docker compose --project-directory . --env-file .local/docker/env/docker.env \
  -f infra/docker/compose/docker-compose.yml up -d db
```

The host backend and frontend bind ports 8787 and 5173 by default, matching the
Compose stack. Stop those host processes before starting the full Compose stack.
Install all workspace dependencies once from the repo root with `pnpm install`.

Then run the backend/frontend outside Docker:

- Backend:
  - Copy `backend/.env.example` to `backend/.env`. Match `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, and `POSTGRES_SCHEMA` to the Docker environment; set `POSTGRES_HOST=localhost` and `POSTGRES_PORT` to `POSTGRES_HOST_PORT` (5432 by default). Generate `JWT_SECRET` and `ENCRYPTION_KEY` using the commands in the example and choose your local `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
  - `cd backend && pnpm run dev`
- Frontend:
  - Copy `frontend/.env.example` to `frontend/.env` and set required values.
  - `cd frontend && pnpm run dev`

Optional: local “production-style” run on the host (advanced):

- `pnpm run deploy:localhost` (or `bash ./scripts/deploy-localhost.sh`)
  - It builds `backend/dist` and `frontend/dist`, then serves the frontend via `vite preview`.
  - For first-time installs, pass `--first-time` to run migrations before startup.
  - Otherwise, migrations run automatically when the backend starts.
  - See [Localhost Deployment](docs/how-to/deploy-localhost.md).

## Running tests

### First-time test setup

Integration tests require an isolated PostgreSQL test database. The schema-sync
command below reads the database connection in `backend/.env` (or environment
variables that override it). Configure it to target a disposable test database,
not a database with data you need to retain. With Compose, the database is
reachable through `localhost` and `POSTGRES_HOST_PORT` (5432 by default).

Before running tests for the first time, set up that test database schema:

```bash
# From repo root
cd backend
pnpm run build:skip-generate
pnpm run db:schema:sync
```

This creates all database tables in your test database. The test environment (`NODE_ENV=test`) skips migrations by design and uses schema synchronization instead.

### Running tests

```bash
# From repo root
pnpm run test:unit           # Unit tests only
pnpm run test:integration    # Integration tests only
pnpm run test:e2e            # E2E tests (requires services running)
pnpm run test:ci             # All tests (unit + integration + e2e)
```

Playwright uses `test/e2e/playwright.config.ts` as the canonical E2E config path.

**Note:** Integration and E2E tests require:
- PostgreSQL running (Docker or local)
- Database schema synced (see above)
- For E2E: Backend and frontend services running

## Running checks

Run the workspace commands used by CI from the repo root:

```bash
pnpm run typecheck
pnpm run lint
pnpm run release-notes:preflight -- --base-ref origin/main
```

Typecheck covers the backend, frontend, and frontend host. Lint covers backend,
frontend, packages, scripts, and tests and rejects warnings. The release-note
preflight validates the release baseline, fragments, package versions, and path
coverage and writes `.artifacts/release-notes-preview.md` for review.

`pnpm --dir frontend run build` is an additional frontend bundle check. Database,
browser, security, and image acceptance are separate CI lanes; these checks do
not replace them.

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
- Add a structured `.release-notes/*.json` fragment for release-impacting
  changes and run `pnpm run release-notes:validate` and
  `pnpm run release-notes:preview`, or the combined preflight above.
- Use `release-note:none` only for internal changes, with a concrete
  `Release-note exemption:` reason in the PR body.
- Follow the [documentation publication policy](docs/development/documentation-publication-policy.md):
  keep repository docs technical, product-development material outside Git,
  customer docs in the `enterpriseglue.ai` CMS, and transient UI evidence in
  CI or release artifacts.

See [Release-note and versioning process](docs/development/release-notes-process.md)
for the schema, path-aware requirements, Release Please integration, and
post-release checks.

Codex contributors can install and validate the version-controlled
[EnterpriseGlue development workflow plugin](docs/development/codex-workflow-plugin.md).

## Security

If you believe you have found a security vulnerability, do not open a public issue.

See `SECURITY.md` for the preferred reporting process.
