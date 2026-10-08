---
name: enterpriseglue-security-check
description: Use when the user says /security-check, run Trivy, scan EnterpriseGlue Docker images, scan filesystem vulnerabilities, or do a local security scan before shipping.
---

# EnterpriseGlue /security-check

Read `.windsurf/workflows/security-check.md` from the resolved repository root when present.

Codex adaptation:
- Treat `/security-check` as the explicit workflow trigger.
- Read `../../references/repository-lifecycle.json` before selecting a target.
  Exclude retired repositories unless the user explicitly requests a read-only
  historical assessment; never update or publish from that assessment.
- Check whether Trivy is installed before scanning.
- Resolve the requested artifact composition before scanning. Release checks
  include backend, frontend and managed-shard bootstrap when present, including
  pinned predecessor dependencies. A filesystem audit is early feedback, not
  image acceptance. Record exact subjects, platform, scanner and scan time;
  mutable tags and yesterday's vulnerability database are not fresh acceptance.
- Check known dependency and pinned-base risks before expensive qualification.
  Exact built-image scans still gate candidate acceptance, before functional
  image/browser qualification; do not replace them with advisory prechecks.
- Report findings by severity. Keep the candidate's committed scanner,
  severity and ignore policy unchanged. Never use `--ignore-unfixed`, add an
  exception or lower severity to make acceptance pass. A user-requested filtered
  diagnostic is incomplete evidence, not a release qualification.
