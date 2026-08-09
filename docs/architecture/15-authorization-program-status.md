# Authorization Program Status and Next Delivery Work

This document reconciles the older broad authorization roadmap with the
implemented tenancy, runtime-resource, SSO, native-grant migration, and
mirrored-backstop work. It is deliberately a status document: a checked item
means it is implemented and covered by its stated supported contract, not that
every possible external IdP or customer engine is certified.

## Implemented supported capability

- EnterpriseGlue-authoritative RBAC, roles, groups, custom roles, policies,
  machine principals, and Effective Access explanations.
- Engine tenancy: explicit dedicated/shared topology, resolved resource tenant
  boundaries, runtime-resource and runtime-resource-set scopes, and external
  registration requiring explicit tenancy.
- SSO assignment, entitlement, OIDC/SAML/LDAP normalization, and safe
  compatibility/migration paths.
- Camunda 7 native-grant inventory and migration tooling with a read-only
  import phase and ownership-scoped configuration rollback.
- Mirrored Camunda 7/Operaton backstop: encrypted group mapping, exact group `READ`
  projection, hash-bound preview/apply, lease-backed retry, encrypted owned-ID
  evidence, ownership-only rollback, read-only tracked-ID drift observations,
  OpenAPI/action contracts, the Mission Control backstop panel, bounded
  customer-sidecar transport, and five database-adapter persistence coverage.

## Current deliberately unsupported boundary

The following source shapes are visible as blocked or manual-required rather
than projected: direct users and machine principals, global or engine-wide
grants, wildcard resources, revokes, unresolved or cross-tenant resources,
expired assignments, unsupported permissions, task/instance/deployment/admin
resources, and any ambiguous group mapping. Direct user identity provisioning
is customer/IdP-owned.

## Remaining program work

| Workstream | Required outcome | Status |
| --- | --- | --- |
| Backstop drift check | Read only tracked native IDs and mark altered/missing grants `out_of_sync`; never touch unrelated native grants. | Implemented: linked durable observation receipt and dedicated action/API |
| Configuration bundles | `engine-backstop-mappings.json` supports secret references, preflight, import/apply, diff, authoritative disable, and opaque export. | Implemented |
| Mission Control UI | Native-backstop panel with prerequisite guidance, sanitized receipt/history, and browser/accessibility coverage. | Implemented |
| Direct-user certification | Prove synthetic mapped-group allow and sibling-deny against a real Camunda identity provider. | Requires local/representative IdP fixture |
| Customer-sidecar support | Customer-owned downstream authentication; bounded tracked native-authorization create/read/delete calls with no direct-engine fallback. | Implemented for the reference adapter and local Operaton Docker evidence; production-like customer environment evidence remains environment-dependent |
| `engine_native_authority` | Separate native inventory/import, precedence, identity, and reconciliation product. | Deferred; not a compatibility shortcut |
| Extended external evidence | Run deployed OIDC, SAML, LDAP, OpenShift, and production-like sidecar evidence. | Environment-dependent |
| Deployment evidence matrix | Stable PR, identity-emulator, Docker/Operaton, and protected real-OpenShift lanes with sanitized same-commit receipts. | Implemented; external OpenShift receipt remains pending until exercised against a clean candidate |

## Delivery gate

The mode remains `enterpriseglue_authoritative` by default. Enabling
`mirrored_engine_backstop` requires at least one successful retained backstop
receipt, and each individual apply independently rechecks the source and
desired hashes. No compatibility path, existing engine row, or customer native
grant is removed by this program.

The executable evidence contract and exact external handoff are documented in
[Collect Access-Governance Deployment Evidence](../how-to/collect-access-governance-deployment-evidence.md).
