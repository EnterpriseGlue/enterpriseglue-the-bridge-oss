---
name: enterpriseglue-license
description: Use when the user says /license, refresh OSS license notices, verify third-party notices, check Apache-2.0 compatibility, run licenses:update, or run licenses:check for EnterpriseGlue OSS.
---

# EnterpriseGlue /license

Resolve the OSS repository and use its `licenses:update` and `licenses:check`
scripts as the source of truth.

Codex adaptation:
- Treat `/license` as the explicit workflow trigger.
- This workflow applies to the OSS repo unless the user explicitly asks for analysis elsewhere.
- Provide a clear conflict summary if strict license checks fail.
- Do not ship generated notice changes directly; hand off to `/ship` when the user wants to publish them.
