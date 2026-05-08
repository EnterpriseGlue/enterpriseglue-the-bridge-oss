---
description: Run local tests — from quick typecheck to full CI-equivalent suite
---

# /test — Run Local Tests (OSS)

Comprehensive local testing. Run before `/ship` to catch issues early.

## Step 1: Detect what changed

// turbo
```bash
git diff --name-only main...HEAD
```

Classify changes (use internally, don't show raw output):
- **backend_changed**: files under `backend/` or `packages/contracts/`
- **frontend_changed**: files under `frontend/` or `packages/contracts/`
- **infra_changed**: files under `infra/`, `scripts/`, or Dockerfiles
- **ci_only**: only `.github/`, `docs/`, `*.md`, `local-docs/`

If **ci_only**, tell the user:
> Only CI/docs files changed — no application tests needed. Safe to `/ship`.

Stop here if ci_only.

## Step 2: Choose test level

Show the full menu using `ask_user_question`. Each level is **cumulative** — it
includes everything from the levels above it:
- **Quick** — Typecheck + unit tests (~30s, no deps)
- **Verify** — Quick + backend build check (~45s, no deps)
- **Integration** — Verify + backend integration tests (~2min, needs PostgreSQL)
- **E2E** — Integration + Playwright smoke tests (~5min, needs Docker stack)

Default recommendation based on what changed:
- Backend only → **Verify**
- Frontend only → **Quick**
- Both or unsure → **Quick**

## Step 3: Run selected tests

Levels are cumulative. Always start from the top and run through the selected level.

### 1. Quick (always runs)

No external dependencies needed.

If only backend changed:
```bash
npm --prefix backend run typecheck
```
```bash
npm --prefix backend run test:unit
```

If only frontend changed:
```bash
npm --prefix frontend run typecheck
```
```bash
npm --prefix frontend run test:unit
```

If both changed:
```bash
npm run typecheck
```
```bash
npm run test:unit
```

If the selected level is **Quick**, stop here.

### 2. Verify (runs after Quick)

Proves the backend compiles cleanly (typecheck + build + unit in one command):

```bash
npm --prefix backend run verify
```

If frontend also changed, add:
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test:unit
```

If the selected level is **Verify**, stop here.

### 3. Integration (runs after Verify)

Requires local PostgreSQL on port 5432.

Pre-check:
// turbo
```bash
pg_isready -h localhost -p 5432 2>/dev/null && echo "PG_READY" || echo "PG_NOT_READY"
```

If not ready:
> PostgreSQL is not running. Start it with:
> ```bash
> docker compose -f infra/docker/compose/docker-compose.yml up -d postgres
> ```
> Or choose a lower test level.

If ready:
```bash
npm run test:integration
```

If the selected level is **Integration**, stop here.

### 4. E2E (runs after Integration)

Requires full Docker stack running (backend + frontend + db).

Pre-check:
// turbo
```bash
curl -sf http://localhost:5173 > /dev/null 2>&1 && echo "STACK_READY" || echo "STACK_NOT_READY"
```

If not ready:
> Docker stack is not running. Start it with:
> ```bash
> npm run dev
> ```
> Or choose a lower test level.

If ready:
```bash
npm run test:e2e:smoke
```

For full E2E (all specs, not just smoke):
```bash
npm run test:e2e
```

## Step 4: Additional test options (offer if user asks)

These are heavier tests that mirror the full CI pipeline:

### Smoke against built Docker images

Builds production Docker images locally and runs health + auth checks:
```bash
npm run smoke:images:local:fast
```
Variant with Oracle:
```bash
npm run smoke:images:local
```
Variant with auth flow:
```bash
npm run smoke:images:local:auth:fast
```

### Full CI PR suite (mirrors GitHub CI exactly)

Runs unit + integration + e2e smoke + test data cleanup:
```bash
npm run test:ci:pr
```

### Full CI suite

Runs unit + integration + full e2e + cleanup:
```bash
npm run test:ci
```

## Step 5: Report

Summarize results:
- **Pass**: "All tests passed ✓ — safe to `/ship`."
- **Fail**: Show the failing test name and output. Ask:
  - **Fix it** — help debug the failure
  - **Ship anyway** — CI will catch it, but not recommended
  - **Abort** — stay on branch

## Reference: All local test commands

| Command | Requires | ~Time |
|---------|----------|-------|
| `npm run typecheck` | Nothing | 10s |
| `npm --prefix backend run guard:no-raw-sql` | Nothing | 2s |
| `npm run test:unit` | Nothing | 30s |
| `npm --prefix backend run verify` | Nothing | 45s |
| `npm run test:integration` | PostgreSQL | 2min |
| `npm run test:e2e:smoke` | Docker stack | 3min |
| `npm run test:e2e` | Docker stack | 5min |
| `npm run smoke:images:local:fast` | Docker | 5min |
| `npm run smoke:images:local` | Docker + Oracle | 10min |
| `npm run test:ci:pr` | Docker stack + PG | 5min |
| `npm run test:ci` | Docker stack + PG | 8min |

## Notes for Cascade

- Always run typecheck before unit tests — catches compile errors first
- Backend `test:unit` includes `guard:no-raw-sql` (SQL injection prevention)
- Frontend vitest uses jsdom — no browser or Docker needed
- Integration tests need `DATABASE_URL` or local PostgreSQL on port 5432
- E2E tests need the full app stack (backend + frontend + db)
- `test:ci:pr` is what GitHub CI runs on PRs — if this passes locally, CI will pass
- If tests fail with module errors, suggest `npm install` first
- The user can run `/test` independently or before `/ship` — it's their choice
