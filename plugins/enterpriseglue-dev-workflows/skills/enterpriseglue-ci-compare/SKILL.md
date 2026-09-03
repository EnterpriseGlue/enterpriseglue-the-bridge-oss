---
name: enterpriseglue-ci-compare
description: Use when the user says /ci-compare, compare CI, check OSS host and plugin-consumer workflow drift, compare release automation, inspect reusable workflow contracts, or check public package compatibility.
---

# EnterpriseGlue /ci-compare

Resolve the OSS host and the owning plugin repository or external-consumer
fixture. Compare their current default-branch workflows, reusable
inputs/outputs, required checks, public package versions, compatibility lanes,
and release automation.

Codex adaptation:
- Treat `/ci-compare` as the explicit workflow trigger.
- This workflow is read-only. Do not edit workflow files or bump packages.
- Report drift as intentional, likely drift, or requires review.
- Pay special attention to reusable workflow contracts, external package
  consumption, plugin API compatibility, package publish workflows, and signed
  plugin artifact qualification.
- Treat the retired standalone EE repository as historical and read-only. Only
  inspect it when the user explicitly requests a legacy audit; never make it a
  current CI parity target.
