# Observability and Logs

Summary: How to monitor health and access logs for the platform.

Audience: Developers and architects.

## Health Checks
- Dev backend health endpoint: `http://localhost:8787/health` (default)
- Production (same-origin via Nginx): `http://localhost:8080/health` (default frontend host/port)

## Docker Logs
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f backend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f frontend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f db
```

## Host-Based Logs (deploy-localhost)
- Backend: `backend/server.log`
- Frontend: `frontend/preview.log`

## Startup Validation
- Backend prints configuration and database type on startup.
- Feature flags can be logged via backend configuration helpers.
