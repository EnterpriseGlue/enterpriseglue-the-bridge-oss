---
name: enterpriseglue-security-check
description: Use when the user says /security-check, run Trivy, scan EnterpriseGlue Docker images, scan filesystem vulnerabilities, or do a local security scan before shipping.
---

# EnterpriseGlue /security-check

Read `.windsurf/workflows/security-check.md` from the resolved repository root when present.

Codex adaptation:
- Treat `/security-check` as the explicit workflow trigger.
- Check whether Trivy is installed before scanning.
- Ask what to scan if the user did not specify backend, frontend, both images, or filesystem.
- Report HIGH and CRITICAL findings separately and do not suppress findings unless the user asks for `--ignore-unfixed`.
