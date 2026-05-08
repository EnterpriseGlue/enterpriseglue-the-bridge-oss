---
description: Audit and update npm dependencies, then ship as a chore PR
---

# /deps — Dependency Management

Audit vulnerabilities, update packages, run tests, and ship.

## Step 1: Audit current state

// turbo
```bash
npm --prefix backend audit --omit=dev 2>/dev/null | tail -5
```
// turbo
```bash
npm --prefix frontend audit --omit=dev 2>/dev/null | tail -5
```

Summarize: N vulnerabilities found (critical/high/moderate/low).

## Step 2: Choose action

Ask the user using `ask_user_question`:
- **Update all** — `npm update` in both backend and frontend
- **Update one package** — specific package (user provides name)
- **Audit only** — just show vulnerabilities, don't change anything

If audit only, stop after showing results.

## Step 3: Create branch

// turbo
```bash
git checkout main && git pull origin main
git checkout -b chore/update-deps
```

## Step 4: Update

For update all:
```bash
npm --prefix backend update
npm --prefix frontend update
```

For specific package:
```bash
npm --prefix {backend|frontend} install {package}@latest
```

## Step 5: Verify

```bash
npm run typecheck && npm run test:unit
```

If tests fail, show the failure and ask:
- **Revert** — `git checkout -- package.json package-lock.json backend/ frontend/`
- **Fix** — help resolve the issue
- **Ship anyway** — proceed (risky)

## Step 6: Ship

```bash
git add -A
git commit -m "chore(deps): update dependencies"
git push -u origin chore/update-deps
gh pr create --fill
```

Then follow the standard `/ship` merge flow (watch CI, merge).

## Notes for Cascade

- Always run tests after updating — dependency updates are a common source of breakage
- The commit type is `chore` — this gets `release:internal` label (no version bump)
- For security-related updates, use `fix(deps):` instead to get `release:security`
