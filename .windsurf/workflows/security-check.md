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
trivy image --exit-code 1 --severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN --ignorefile .trivyignore --format table bridge-backend-scan:local
trivy image --exit-code 1 --severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN --ignorefile .trivyignore --format table bridge-frontend-scan:local
```

For filesystem:
// turbo
```bash
trivy fs --exit-code 1 --severity CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN --ignorefile .trivyignore --format table .
```

## Step 5: Report

Summarize findings:
- Total findings by severity per image; distinguish advisory filesystem scans
  from actual image acceptance
- Any new CVEs not seen in the nightly scan

If clean:
> No unignored vulnerabilities found in the scanned images. Other required
> acceptance checks still apply.

If findings exist:
> Found {N} vulnerabilities. Fix the dependencies or affected implementation
> before shipping. An unfixed advisory is not permission to bypass acceptance.

## Notes for Cascade

- Image analysis is local; scanner databases and registry images may be fetched.
- The nightly GitHub security scan (`security-nightly.yml`) runs Trivy on
  published images, so this is a pre-push safety net
- Backend/frontend candidate acceptance rejects CRITICAL, HIGH, MEDIUM, LOW and
  UNKNOWN using the committed `.trivyignore`. Plugin toolchain candidate images
  have a separate HIGH/CRITICAL gate. Do not confuse either with nightly drift
  thresholds or claim a HIGH/CRITICAL-only scan qualifies an application image.
- The exact-candidate scanner is pinned in
  `.github/workflows/release-candidate-stage.yml`; use that image for final local
  acceptance. `scripts/check-plugin-platform-production-images.sh` runs the
  same per-image thresholds and scanner. Do not rerun builds when the exact
  image inputs already have valid evidence.
- Never add an exception, lower severity, or use `--ignore-unfixed` for candidate
  acceptance merely to make the scan pass. Report a diagnostic filtered scan
  as incomplete, not release acceptance.
