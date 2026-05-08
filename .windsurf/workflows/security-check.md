---
description: Run a local Trivy security scan on Docker images before pushing
---

# /security-check — Local Security Scan

Run Trivy locally to catch vulnerabilities before they hit CI.

## Step 1: Check Trivy is installed

// turbo
```bash
trivy --version 2>/dev/null || echo "NOT_INSTALLED"
```

If not installed:
> Trivy is not installed. Install it with:
> ```bash
> brew install trivy
> ```
> Then run `/security-check` again.

Stop here if not installed.

## Step 2: Choose what to scan

Ask the user using `ask_user_question`:
- **Backend image** — Scan the backend Docker image
- **Frontend image** — Scan the frontend Docker image
- **Both** — Scan both images
- **Filesystem** — Scan the local codebase (no Docker build needed)

## Step 3: Build images (if scanning Docker images)

For backend:
```bash
docker build -f backend/Dockerfile.prod -t bridge-backend-scan:local .
```

For frontend:
```bash
docker build -f frontend/Dockerfile.prod -t bridge-frontend-scan:local .
```

## Step 4: Run Trivy

For Docker images:
```bash
trivy image --severity HIGH,CRITICAL --format table bridge-backend-scan:local
trivy image --severity HIGH,CRITICAL --format table bridge-frontend-scan:local
```

For filesystem:
// turbo
```bash
trivy fs --severity HIGH,CRITICAL --format table .
```

## Step 5: Report

Summarize findings:
- Total HIGH / CRITICAL CVEs per image
- Any new CVEs not seen in the nightly scan

If clean:
> No HIGH/CRITICAL vulnerabilities found. Safe to ship.

If findings exist:
> Found {N} vulnerabilities. Review above and decide:
> - Fix before shipping (recommended for CRITICAL)
> - Ship anyway and track in nightly scan (acceptable for HIGH with no fix available)

## Notes for Cascade

- This is purely local — no data leaves the machine
- The nightly GitHub security scan (`security-nightly.yml`) runs Trivy on
  published images, so this is a pre-push safety net
- Use `--ignore-unfixed` flag if the user only wants actionable findings
