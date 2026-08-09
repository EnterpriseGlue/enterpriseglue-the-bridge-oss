# Migrate Governance Settings Ownership

Summary: Safe operator procedure for transferring, releasing, or retiring the
configuration ownership of EnterpriseGlue platform governance settings.

Audience: Platform administrators, GitOps owners, release operators, and
incident responders.

## What This Procedure Changes

The workflow changes the source and ownership metadata for exactly these
settings:

- `engineOnboardingMode`;
- `projectEngineTargetMode`;
- `engineAccessAuthority`;
- `projectAccessAuthority`; and
- `engineRuntimeAuthorizationMode`.

It does not delete, recreate, reassign, or transfer any engine, Engine Set,
runtime resource, runtime-resource set, role, assignment, group, membership,
identity provider, identity mapping, or project-engine target. Existing
customers do not re-add an engine after an ownership change.

## Choose The Operation

| Goal | Operation |
| --- | --- |
| Make another bundle the settings source of truth | `transfer` |
| Return settings to editable manual ownership | `release` |
| Retire the bundle that currently owns settings and record that intent | `retire` |

`release` and `retire` both produce manual settings ownership. Use `retire`
only as part of a bundle-retirement change because its receipt records that
specific intent. Retiring governance ownership does not retire the bundle's
managed objects. Their lifecycle remains explicit through normal
configuration preview/apply.

## Preconditions

Before preview:

1. Confirm the intended target bundle key and whether portal edits should be
   warned (`config_warn`) or blocked (`config_locked`).
2. Export and retain the current owning bundle and its latest apply receipt.
3. Verify break-glass Platform Admin access and prove that removing the
   canonical membership immediately rejects a concurrent recovery login plus
   the next request and refresh from an already-open recovery session. Restore
   the approved recovery membership after recording the evidence.
4. Confirm the actor has configuration bundle view, preview, and apply
   permission.
5. Stop concurrent governance-setting and configuration-bundle changes for
   the short migration window.

No database backup is required specifically for this metadata-only operation,
but normal deployment backup policy still applies.

## Portal Procedure

1. Open **Platform Settings > Configuration Bundles**.
2. In **Governance ownership**, verify the current owner and drift state.
3. Select **Transfer to a bundle**, **Release to manual management**, or
   **Retire current bundle ownership**.
4. Enter an operational reason. For transfer, enter the stable bundle key and
   management behavior.
5. Select **Preview ownership change**.
6. Review the current and desired owner, the five affected fields, all
   preserved object types, expiry, and conflicts.
7. Accept every displayed consequence acknowledgement.
8. Select **Apply exact ownership preview**.
9. Record the returned receipt ID and refresh ownership.

The portal reads the current owner from the server. It never guesses the
source reference from an earlier page load.

## Headless Procedure

Use a non-human configuration client with both `config:bundle:manage` scope
and the required configuration-bundle RBAC permissions.

```bash
base="${ENTERPRISEGLUE_API_URL%/}"
auth="Authorization: Bearer $ENTERPRISEGLUE_API_TOKEN"

curl --fail-with-body \
  -H "$auth" \
  "$base/api/authz/config-bundles/governance-ownership"
```

Create `ownership-request.json` with the current `sourceRef` returned above:

<!-- enterpriseglue-config-schema: GovernanceOwnershipRequestSchema -->
```json
{
  "operation": "release",
  "expectedCurrentSourceRef": "config_bundle:old.authz",
  "reason": "Return governance settings to reviewed manual administration."
}
```

```bash
curl --fail-with-body \
  -X POST \
  -H "$auth" \
  -H "Content-Type: application/json" \
  --data @ownership-request.json \
  "$base/api/authz/config-bundles/governance-ownership/preview" \
  > ownership-preview.json
```

Review `ownership-preview.json`. Build the apply body by retaining every
request field and adding the returned `previewHash`, `previewExpiresAt`, every
`requiredAcknowledgements` value, and a unique `idempotencyKey`. Do not edit
the request after preview.

```bash
curl --fail-with-body \
  -X POST \
  -H "$auth" \
  -H "Content-Type: application/json" \
  --data @ownership-apply.json \
  "$base/api/authz/config-bundles/governance-ownership/apply" \
  > ownership-receipt.json

curl --fail-with-body \
  -H "$auth" \
  "$base/api/authz/config-bundles/governance-ownership/receipts?limit=10"
```

## Success Criteria

The change is complete only when all of these checks pass:

- the apply response and receipt history contain the same receipt ID and
  preview hash;
- current ownership equals the preview's desired state;
- transfer reports `drifted` until the target bundle is applied, while release
  and retire report manual ownership;
- the five governance setting values themselves are unchanged by the
  ownership operation;
- representative engines, roles, assignments, groups, identity mappings, and
  project targets still exist with their prior ownership;
- the current user's permission snapshot has refreshed and the portal controls
  reflect `manual`, `config_warn`, or `config_locked`; and
- audit contains `authz.governance_ownership.preview` and
  `authz.governance_ownership.apply` without secrets or bundle content.

After a transfer, preview and apply the target bundle promptly to make its
declared governance values authoritative and move the drift state to
`in_sync`.

## Failure Recovery

| Failure | Recovery |
| --- | --- |
| Preview reports `governance_source_owner_mismatch` | Refresh current ownership, investigate the concurrent change, then create a new preview. There is no force option. |
| Preview expires | Create a new preview and repeat the acknowledgements. |
| Apply reports state changed after preview | Stop concurrent changes, read current ownership, and preview again. |
| Apply times out after submission | Retry the same body with the same idempotency key. A completed transaction returns the existing receipt. |
| Idempotency key was used for another preview | Generate a new key only after generating a new preview. |
| Target bundle cannot be applied after transfer | Use a new exact ownership preview to transfer back to the prior bundle or release to manual ownership. |

Do not repair any of these conditions by modifying provenance columns in the
database.

## Rollback

Ownership rollback is another forward, audited operation:

- reverse a transfer with a new `transfer` preview naming the previous bundle;
- reverse a release or retirement with a new `transfer` preview naming the
  intended bundle; or
- remove bundle ownership with a new `release` preview.

Use a new reason, preview hash, acknowledgements, and idempotency key. The
original receipt remains immutable. Because managed objects never change in
this workflow, rollback does not recreate engines or access grants.

## Evidence To Retain

Retain the sanitized preview, apply receipt, receipt-history response, before
and after current-ownership responses, audit event IDs, and the target bundle
apply receipt. Never retain bearer tokens, resolved secrets, or complete
identity claims in the evidence package.
