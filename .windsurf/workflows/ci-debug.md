---
description: Investigate a failed CI run — fetch logs, identify root cause, suggest fix
---

# /ci-debug — Debug a Failed CI Run

Quickly diagnose why CI failed and suggest a fix.

## Step 1: Find the failed run

// turbo
```bash
gh run list --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --status failure --limit 5
```

If the user mentions a specific PR:
// turbo
```bash
gh pr checks {PR_NUMBER} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss
```

Ask the user which run to investigate if multiple failures exist.

## Step 2: Get failed job details

```bash
gh run view {RUN_ID} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss
```

Identify which job(s) failed.

## Step 3: Fetch failure logs

```bash
gh run view {RUN_ID} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --log-failed 2>&1 | tail -80
```

## Step 4: Diagnose

Analyze the logs and categorize:

- **Test failure** — which test, what assertion, likely cause
- **Build failure** — TypeScript error, missing dependency
- **Infra failure** — Docker build, network, timeout
- **Flaky test** — passed locally but failed in CI (timing, resource)

## Step 5: Suggest fix

Based on diagnosis:

- **Test failure** → show the failing test, suggest code fix
- **Build failure** → show the error, suggest fix
- **Infra failure** → suggest re-running: `gh run rerun {RUN_ID} --repo EnterpriseGlue/enterpriseglue-the-bridge-oss --failed`
- **Flaky test** → suggest re-run first, then investigate if it fails again

Ask the user:
- **Fix now** — apply the fix locally, then `/test` and `/ship`
- **Re-run CI** — `gh run rerun {RUN_ID} --failed`
- **Skip** — leave for later

## Notes for Cascade

- Always show the actual error message, not just the job name
- The `--log-failed` flag only shows output from failed steps
- If the failure is in `ci-complete`, look at which upstream job actually failed
- For EE, use `--repo EnterpriseGlue/enterpriseglue-the-bridge-ee`
