---
name: enterpriseglue-contract-parity
description: Verify that EnterpriseGlue portal controls, OpenAPI, public schemas, JSON configuration, TypeORM persistence, examples, and developer documentation stay aligned. Use for /contract-parity, headless configuration changes, engine registration, SSO settings, public API additions, schema updates, or suspected interface drift.
---

# EnterpriseGlue Contract Parity

1. Resolve the worktree and read `references/parity-matrix.md`.
2. Analyze the diff before editing:

   ```bash
   node <skill-dir>/scripts/check-contract-parity.mjs \
     --base-ref origin/main --strict
   ```

3. Trace every new or changed setting end to end: canonical schema, validation,
   persistence, service/API, OpenAPI, JSON configuration, portal control and
   ownership state, examples, tests, and developer/user documentation.
4. Keep TypeORM the persistence authority. Require migrations and adapter
   registration for durable schema changes; isolate genuinely database-specific
   SQL and qualify all supported adapters.
5. Run affected contract gates, including configuration-bundle, documentation,
   route/OpenAPI inventory, engine-tenancy documentation, database portability,
   and published plugin API compatibility.
6. Report each setting or resource as `aligned`, `not applicable`, or `gap`.
   Do not treat generated OpenAPI output alone as proof that implementation,
   examples, and configuration ownership agree.
