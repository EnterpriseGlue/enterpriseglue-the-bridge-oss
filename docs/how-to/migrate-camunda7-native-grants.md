# Migrate Camunda 7 Native Grants

Use this workflow to convert a conservative, supported subset of existing
Camunda 7 authorizations into EnterpriseGlue access controls. It is an import
tool, not a runtime native-authority mode.

## What it changes

The workflow reads `GET /authorization` from the selected Camunda 7 engine.
It never creates, updates, or deletes a Camunda authorization. EnterpriseGlue
continues to use `enterpriseglue_authoritative` for human access decisions.

When approved, it creates a dedicated additive configuration bundle containing
only new EnterpriseGlue groups, a least-privileged engine reader role, exact
Runtime Resource Sets, and group assignments. The existing engine is
referenced by its immutable EnterpriseGlue id; do not delete or re-add an
engine that was added through the UI or an external registration API.

## Prerequisites

- The engine is a reachable `camunda7` engine with active runtime inventory.
- Its tenancy diagnostics are healthy. A shared engine needs resolved runtime
  tenants for every imported process/decision resource.
- The operator has native-grant preview, sensitive-detail, draft, configuration
  preview, and configuration apply permissions. Sensitive detail is separate
  because it can reveal native group identifiers.
- For the initial safe UI flow, choose a new configuration key beginning with
  `migration.camunda-native-` and create new EnterpriseGlue groups. Mapping to
  an existing group is intentionally a separate, reviewed configuration change
  in this release.

## UI workflow

1. Open the Camunda 7 engine in Mission Control and select **Migrate existing
   Camunda grants**.
2. Select **Read native grants**. Review only the sanitized counts first.
3. Select **Map proposed groups**. This requires sensitive-detail permission
   and reveals source group identifiers only in this protected view.
4. Review the generated EnterpriseGlue group keys and names, the migration
   configuration key, and the tenant key. Keep the bundle additive.
5. Select **Generate reviewed draft**. It includes only exact group `READ`
   grants on active, unambiguous process definitions and decision definitions.
6. Select **Apply reviewed draft** only after reviewing its object counts. The
   server applies the exact stored draft hash and records a configuration apply
   receipt on the import run.
7. In **Effective Access**, test at least one intended member and one
   non-member for every imported process/decision key. Confirm both an allow
   and a deny before relying on the imported access.

The UI intentionally leaves global grants, user grants, revokes, broad `*`
grants, unsupported resource types, and missing/ambiguous inventory outside
the draft. Resolve those items as explicit manual policy work; do not treat a
successful import as evidence that they were converted.

## Rollback

While the encrypted detailed snapshot remains available (maximum 30 days), an
applied run offers **Preview rollback**. It generates an authoritative empty
version of the same dedicated migration bundle. The preview lists the exact
import-owned objects that will be archived and returns the required archive
acknowledgements.

After reviewing the preview, acknowledge the removal and select **Roll back
imported configuration**. This archives only groups, roles, Runtime Resource
Sets, and assignments created by that migration bundle. It does not:

- delete or reconfigure the engine;
- change tenancy, runtime scope, credentials, or connection settings;
- modify native Camunda grants; or
- delete manual, SSO/API-owned, or unrelated configuration-owned records.

Save the original apply and rollback receipt ids with the change record. If the
encrypted snapshot has expired, create a fresh read-only preview and compare
the retained sanitized receipt before deciding on a manual remediation.

## Stop conditions

Do not apply when an inventory is truncated, a resource is unresolved or
ambiguous, a shared-engine tenant is unresolved, an ownership conflict is
reported, a draft/rollback hash changes, or any expected Effective Access deny
case is allowed. Native Camunda access can remain in place as a separately
governed direct-access path during this migration.

For the architecture and supported translation matrix, see
[Camunda 7 Native Grant Migration Plan](../architecture/13-camunda-7-native-grant-migration-plan.md).
