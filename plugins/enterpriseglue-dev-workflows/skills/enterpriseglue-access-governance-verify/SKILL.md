---
name: enterpriseglue-access-governance-verify
description: Select, run, and report EnterpriseGlue SSO and fine-grained authorization verification. Use for /authz-verify, access-governance testing, identity reconciliation, engine modes, resource-type grants, tenant isolation, custom roles, variable permissions, Operaton backstops, sidecars, or identity-provider emulator evidence.
---

# EnterpriseGlue Access Governance Verification

1. Resolve the active worktree and read `references/test-matrix.md`.
2. Select lanes from the diff:

   ```bash
   node <skill-dir>/scripts/select-authz-lanes.mjs --base-ref origin/main
   ```

3. Run the structural and contract lanes first, followed by selected unit,
   mutation, browser, emulator, container, database, and evidence lanes. Use
   Docker/local services only when their lane is selected.
4. Prove positive and negative outcomes: allowed scope, sibling denial,
   cross-tenant denial, resource-type mismatch denial, and immediate removal
   after entitlement or mapping revocation.
5. For identity changes, cover OIDC/Entra-compatible OIDC, SAML, and LDAP as
   selected. Verify mandatory login reconciliation adds and removes rights
   without deleting unrelated manual/provider access.
6. For engine-governance changes, prefer Operaton real-container evidence.
   Cover enterprise-authoritative, engine-native, mirrored-backstop, and
   credentialless customer-sidecar behavior when affected.
7. Report commands, versions, adapters, fixtures, artifacts, pass/fail counts,
   skipped lanes, limitations, and external evidence separately. Never claim
   real-provider or real-platform evidence from an emulator.
