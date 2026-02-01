# Getting Started (Docker Quickstart)

Summary: Run the EnterpriseGlue platform locally using Docker Compose.

Audience: Developers and architects.

## Prerequisites
- Docker Desktop (or Docker Engine)
- Docker Compose plugin (`docker compose`)

## Steps
1. Copy the Docker env file:
   ```bash
   cp .env.docker.example .env.docker
   ```
2. Start the stack:
   ```bash
   npm run dev
   ```
3. Open the app:
   - Frontend: http://localhost:5173
   - Backend: http://localhost:8787
4. Log in with the admin credentials from `.env.docker`:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - Optional: set `ADMIN_EMAIL_VERIFICATION_EXEMPT=true` to allow the seeded admin to bypass email verification

## Stop the stack
```bash
npm run down
```

## Notes
- Docker uses a PostgreSQL container by default (see `.env.docker`).
- Git repositories are stored at `./data/repos` inside the backend container.
- To change ports or database settings, update `.env.docker`.
- If email verification is enabled, configure `RESEND_API_KEY` to receive verification links.

## Non-Docker local deployment
For a localhost deployment (build + preview) using the production-style script, see:
- [Localhost Deployment (First-time install)](deploy-localhost.md)
  - First-time installs should use `--first-time` to apply migrations.
