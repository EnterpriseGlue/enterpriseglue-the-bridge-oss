---
name: enterpriseglue-ci-compare
description: Use when the user says /ci-compare, compare CI, check OSS/EE workflow drift, compare release automation, inspect repository_dispatch contracts, or check OSS package version drift in EE.
---

# EnterpriseGlue /ci-compare

Resolve both OSS and EE repositories and compare their current default-branch
workflows, reusable inputs/outputs, dispatch event types/payloads, required
checks, package versions, and release automation.

Codex adaptation:
- Treat `/ci-compare` as the explicit workflow trigger.
- This workflow is read-only. Do not edit workflow files or bump packages.
- Report drift as intentional, likely drift, or requires review.
- Pay special attention to reusable workflow contracts, repository dispatch names, package publish workflows, and EE sync listeners.
