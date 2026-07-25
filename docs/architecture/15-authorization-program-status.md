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
- Mirrored Camunda 7 backstop: encrypted group mapping, exact group `READ`
  projection, hash-bound preview/apply, lease-backed retry, encrypted owned-ID
  evidence, ownership-only rollback, OpenAPI/action contracts, and five
  database-adapter persistence coverage.

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
| Backstop drift check | Read only tracked native IDs and mark altered/missing grants `out_of_sync`; never touch unrelated native grants. | Next implementation slice |
| Configuration bundles | Add `engine-backstop-mappings.json` with secret references, preflight, import/apply, diff, and export redaction. | Next implementation slice |
| Mission Control UI | Add the native-backstop panel, prerequisite guidance, receipt/history, and accessibility/browser coverage. | Next implementation slice |
| Direct-user certification | Prove synthetic mapped-group allow and sibling-deny against a real Camunda identity provider. | Requires local/representative IdP fixture |
| Customer-sidecar support | Define and prove a bounded authorization-write capability before allowing sidecars. | Deferred by design |
| `engine_native_authority` | Separate native inventory/import, precedence, identity, and reconciliation product. | Deferred; not a compatibility shortcut |
| Extended external evidence | Run deployed OIDC, SAML, LDAP, OpenShift, and production-like sidecar evidence. | Environment-dependent |

## Delivery gate

The mode remains `enterpriseglue_authoritative` by default. Enabling
`mirrored_engine_backstop` requires at least one successful retained backstop
receipt, and each individual apply independently rechecks the source and
desired hashes. No compatibility path, existing engine row, or customer native
grant is removed by this program.
