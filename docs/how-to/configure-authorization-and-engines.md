# Configure Authorization, Identity, And Engines

Summary: Operator workflow for configuring EnterpriseGlue roles, groups, identity mappings, engines, Engine Sets, runtime-resource access, and project-engine targets.

Audience: Platform administrators, identity administrators, engine operators, and deployment engineers.

Status: **Implemented operator guide for 0.11.0.** Platform Settings, Access Control, Identity Providers, Engines, JSON bundle preview/apply/export and startup bootstrap, runtime-resource sets, mandatory sign-in reconciliation for OIDC/SAML/LDAP, engine ingestion controls, and customer-sidecar transport are implemented. Real OpenShift rollout evidence remains an explicit deferred external-acceptance gate rather than a 0.11.0 release blocker; engine-native authority and gateway-claims ingestion are not part of 0.11.0.

Current UI evidence: Access Control, identity providers and mappings,
configuration ownership, engine modes, Effective Access, responsive behavior,
and accessibility are covered by the maintained
[identity/access UI evidence report](../development/identity-access-ui-evidence-report.md).
The architecture plan remains design history rather than an unfinished
operator checklist.

Related design:

- [Authorization and Access Control](../architecture/09-oss-authorization-access-control-model.md)
- [Deploy Authorization Configuration](./deploy-authorization-config.md)
- [Access Governance and Headless Configuration API](../reference/access-governance-and-headless-api.md)

## Configuration Model

EnterpriseGlue authorizes through one model regardless of how configuration is created:

```text
external or local identity
-> internal user and groups
-> scoped role assignments
-> permissions
-> policy and contextual checks
-> allowed resource and action
```

The UI, JSON bundles, CI/CD API, and identity synchronization must all write the same database entities. Runtime requests never authorize directly from JSON files or identity-provider claims.

## Supported Operating Modes

| Concern | Options | Recommended default |
| --- | --- | --- |
| Ordinary local login | `auto`, `enabled`, `disabled` | Start with `auto`; use `enabled` only for a deliberate transition and test the separate administrator-recovery route before `disabled` |
| SSO provider selection | `auto_redirect_single`, `chooser`, `progressive` | `auto_redirect_single` for one redirect provider; `chooser` or `progressive` for multiple providers |
| Identity protocol | Local, OIDC, SAML, LDAP direct, LDAP claims-only | OIDC when available; map all protocols through provider-neutral entitlements |
| Engine access authority | `manual`, `transition_to_sso`, `sso_managed` | `manual` for standalone, then explicit transition |
| Project access authority | `manual`, `transition_to_sso`, `sso_managed` | `manual` unless projects are centrally governed |
| Engine onboarding | `manual_allowed`, `external_only`, `hybrid` | `manual_allowed` for local use; `external_only` for registry-controlled estates |
| Project-engine targets | `manual_allowed`, `external_only`, `hybrid` | `hybrid` when projects remain local but targets are partly centrally managed |
| Runtime scope | `engine_wide`, `resource_aware` | `engine_wide` for distributed engines; `resource_aware` only for central engines |
| Engine connection | `direct`, `customer_sidecar` | `direct`; select `customer_sidecar` only for an explicit customer gateway endpoint |

These controls are independent. Enabling an identity provider does not by
itself lock a member screen, and registering an engine from JSON does not by
itself make its access SSO-managed. Evaluate each UI action against the setting
that owns that action:

| UI or API action | Governing setting | Local mode | Transition or hybrid mode | Managed or external-only mode |
| --- | --- | --- | --- | --- |
| Add, change, or remove engine members and engine-scoped role assignments | `engineAccessAuthority` | Editable with permission | Editable; manual and SSO lineage are shown together | Existing access stays visible, but normal manual mutation controls and write APIs are read-only/403 |
| Add, change, or remove project members and project-scoped role assignments | `projectAccessAuthority` | Editable with permission | Editable; both sources remain visible | Existing access stays visible, but normal manual mutation controls and write APIs are read-only/403 |
| Add an engine | `engineOnboardingMode` | Portal and API/config allowed | Manual and source-owned engine rows coexist | Portal creation is unavailable; config or the external registration API owns onboarding |
| Change project-engine deployment targets | `projectEngineTargetMode` | Manual target management allowed | Manual and source-owned targets coexist | Only config/external target changes are allowed |
| Edit the five settings above in Platform Settings | `settings.ownershipMode` in the applied bundle | Portal-owned | `config_warn` permits the edit and records drift | `config_locked` renders the controls read-only and rejects the settings write API |
| Create a project | `project:create` platform permission | Allowed when granted; the creator receives project owner access | Same | Same; project creation is not an engine-access grant |
| Read or operate on runtime resources | `engineRuntimeAuthorizationMode`, scoped roles, resource sets, and policy | EnterpriseGlue decision | EnterpriseGlue decision, optionally mirrored | Independent from login, onboarding, and member-screen ownership |

The normal recommendation is `engineAccessAuthority = sso_managed` and
`projectAccessAuthority = manual`: SSO decides which engines a person may use,
while authorized organization users can create projects and project owners
manage their collaborators locally. Grant `project:create` through a platform
role to the intended self-service population. A new project is not visible to
every user; its creator receives owner access and can then add collaborators.

Changing an authority to `sso_managed` is non-destructive. Existing manual rows
continue to participate in authorization and remain visible for review, but
the ordinary member and generic assignment write endpoints no longer change
them. Platform Settings owner/delegate recovery actions become read-only too,
and a pending manual project/engine invitation cannot create a new grant after
the cutover. Use transition mode to reconcile duplicates, finish or revoke
pending invitations, and remove unwanted manual grants before the cutover.
Return temporarily to transition/manual only through the reviewed settings
channel if an intentional manual repair is required.

## Configuration Channels

### Platform UI

Use Platform Settings and Access Control for interactive administration:

- Identity Providers: provider connection and protocol settings.
- Identity Mappings: normalized entitlement-to-group rules.
- Roles: system-role inspection and editable custom roles.
- Groups: internal groups and source-owned membership diagnostics.
- Assignments: group, user, API-client, and service-account role assignments.
- Engines: manual engine and customer-sidecar endpoint registration.
- Engine Sets: selector-based groups of engines.
- Project Targets: eligible project-engine relationships and deployment modes.
- Effective Access: decision explanation and remediation links.
- Configuration: bundle preview, apply, history, drift, and export.
- Camunda 7/Operaton engines: protected mirrored-backstop mapping,
  hash-bound import apply, and import-owned rollback.

UI and JSON changes use the same source ownership rules. A config-owned field is not silently overwritten by a manual UI edit.

### JSON Bundle

The target folder layout is:

```text
enterpriseglue-config/
  bundle.json
  roles.json
  groups.json
  identity-providers.json
  identity-mappings.json
  engines.json
  engine-backstop-mappings.json
  engine-sets.json
  runtime-resource-sets.json
  assignments.json
  project-engine-targets.json
  policies.json
```

`bundle.json` declares schema version, bundle id, imports, expected object files, and optional expected hash. This is the manifest name required inside a folder-style ZIP. A mounted single-file bundle instead uses an outer JSON envelope with `bundle` and `files` properties; its file name is arbitrary. Secret values are never stored in either form; provider and engine objects contain secret references only.

Every configurable object has a stable `key`. Config apply resolves keys to database ids, records `source = config`, `sourceRef`, source hash, apply run, and ownership mode, then runtime authorization reads the database. For identity mappings, use the default `config_locked` mode to make the bundle authoritative, or `config_warn` to allow a temporary local edit marked as drift. A subsequent bundle apply restores the reviewed provider, entitlement, target group, sync mode, and ownership state; configuration-managed mappings cannot be deleted from the UI.

When a bundle explicitly declares the five platform governance settings, it
also owns their portal edit behavior:

```text
"governance": {
  "engineMembershipAuthority": "sso_managed",
  "projectMembershipAuthority": "manual",
  "engineRegistrationPolicy": "external_only",
  "projectEngineTargetPolicy": "hybrid",
  "runtimeAuthorizationAuthority": "enterpriseglue_authoritative",
  "governanceSettingsOwnership": "config_locked"
}
```

`governanceSettingsOwnership: "config_locked"` makes those settings read-only in Platform Settings and rejects
manual settings API writes. `config_warn` permits a temporary portal/API edit
and marks the settings drifted; the next reviewed apply restores the declared
values and `in_sync` state. `manual` permits portal/API edits while retaining
the recorded bundle provenance. An older `v1alpha1` bundle with `settings: {}` does not
claim ownership or overwrite current values.

Engine-only `v1beta1` bundles may omit `governance` entirely. Omission is the preferred
headless contract when the bundle should manage inventory without changing
platform governance. See the
[API reference](../reference/access-governance-and-headless-api.md#engine-only-bundle)
for an executable manifest and transport envelope.

For a direct or customer-sidecar Camunda 7 or Operaton defense-in-depth mapping, add
`engine-backstop-mappings.json`. Each entry references a configured compatible
engine and configured EnterpriseGlue group and uses `nativeGroupIdRef` such as
`env://CAMUNDA_OPERATORS_GROUP`. The group id is resolved only while applying
the reviewed bundle, is encrypted at rest, and is never present in bundle
exports, generic audit history, or normal mapping reads. See
[Enable a Mirrored Camunda 7 or Operaton Authorization Backstop](./enable-mirrored-engine-backstop.md)
for the sync, drift-check, and rollback workflow. A customer-sidecar engine
owns its downstream engine credential; complete the
[customer-sidecar readiness runbook](./customer-sidecar-readiness-runbook.md)
before enabling its backstop.

### CI/CD

CI/CD should perform these steps:

1. Validate schema and references without database mutation.
2. Preview against the target environment.
3. Review the create/update/archive/conflict and effective-access impact.
4. Apply the exact preview using its correlation id and bundle hash.
5. Wait for identity, Engine Set, runtime-resource-set, and target reconciliation.
6. Verify readiness, expected hash, and no unresolved high-risk drift.
7. Retain the previous bundle and apply receipt for rollback.

See [Deploy Authorization Configuration](./deploy-authorization-config.md) for the implemented API/CLI and startup-bootstrap workflows, evidence lanes, and the separately deferred real-cluster OpenShift acceptance step.

## Configure Roles And Groups

System roles have immutable ids and permissions. Custom roles are tenant-owned, allow-only permission bundles.

Recommended workflow:

1. Inspect the permission catalog grouped by platform, project, engine, runtime, deployment, and sensitive data.
2. Create a custom role from an explicit permission list or copy a system-role template.
3. Review added and removed permissions in preview.
4. Assign roles to internal groups at platform, project, engine, Engine Set, runtime-resource, or runtime-resource-set scope.
5. Map external entitlements to those groups.

To move a default role into configuration management, open the system role in **Platform Settings > Role Library** and select **Export config role**. Set the owning bundle key, tenant key, stable `custom.*` role key, and ownership mode. The exported JSON contains an explicit permission snapshot; import it in **Platform Settings > Configuration Bundles**, preview the changes, and apply that exact preview.

Users can have different roles on different engines because assignments are scoped:

```text
group payments-observers -> viewer on engine payments-prod
group claims-operators   -> operator on engine claims-prod
same user belongs to both groups
```

Avoid creating one external identity mapping per permission. Map stable enterprise teams to internal groups, then manage scoped role assignments separately.

When the Platform Settings mapping wizard provisions an assignment for a
tenant-owned engine, Engine Set, runtime resource, or runtime-resource set, it
automatically creates the role assignment in that selected target's tenant.
The identity mapping and its external group remain platform-wide, so the same
provider entitlement can still be used consistently across tenant-scoped
assignments. This prevents a platform administrator from accidentally creating
an assignment against a same-id resource in another tenant.

### Control access to Mission Control variable data

Variable data has a separate disclosure boundary from ordinary process and task
visibility. Grant the smallest of the following engine permissions that matches
the operational job:

| Permission | Allows | Does not allow |
| --- | --- | --- |
| `engine:variables:metadata:view` | Variable names, types, IDs, and lifecycle metadata | Reading, copying, filtering by, or changing a value |
| `engine:variables:value:view` | Variable values after EnterpriseGlue applies configured PII redaction | Changing a value |
| `engine:variables:edit` | Creating, replacing, and deleting values | A blind write; it requires both metadata and value permission |

The dependency is enforced consistently by the Role Library, role/assignment
API, configuration-bundle preview, and backend route guard:

```text
engine:variables:edit
  -> engine:variables:value:view
  -> engine:variables:metadata:view
```

Use the immutable templates as follows:

| System role | Variable access |
| --- | --- |
| Engine Owner / Engine Delegate | Metadata, values, and edits |
| Engine Operator | Metadata and values; no edits |
| Runtime Viewer | Metadata only |
| Runtime Investigator | Metadata and values; no edits |
| Variable Operator | Metadata, values, and edits |
| Tenant Viewer | Metadata only in its tenant scope |
| Tenant Engine Operator | Metadata and values in its tenant-scoped runtime resources; no edits |
| Tenant Administrator | Metadata, values, and edits in its tenant scope |

For a custom role, include all prerequisites explicitly. A role that omits a
prerequisite is rejected on creation/update and during configuration preview.
Existing custom roles are not silently widened: update an existing
edit-only/custom role intentionally before relying on variable mutation.

The backend, rather than the browser, enforces the no-value outcome. On every
Mission Control variable read it replaces the value with `null`, sets
`valueRedacted: true`, and removes engine-specific value metadata (such as
`valueInfo` and adapter extension payloads) before the response reaches
EnterpriseGlue. This covers active process and task variables, process-variable
history, both historic variable collection routes, the variable array returned
by execution details, and returned variables from task completion. The UI uses
the server marker to display **Restricted** and disables copy/edit paths.

Configured PII policies remain an additional server-side layer: a user with
`engine:variables:value:view` still receives the PII-redacted representation,
not an automatic bypass. Historic `variableValue` searches require an
engine-wide value grant because a scoped metadata search could otherwise reveal
whether a secret value exists. Prefer a name/type/process filter for
metadata-only investigators.

## Configure Identity Providers

All providers normalize to the same internal envelope:

```text
provider id + external subject + verified identity attributes + entitlements
```

Provider configuration must use an exact provider id. Multiple OIDC, SAML, or LDAP providers can coexist.

Required sequence:

1. Create the provider with issuer/directory endpoints and secret references.
2. Test discovery, signature/certificate, bind/search, TLS, timeout, and claim normalization.
3. Create entitlement-to-group mappings.
4. Preview mappings with representative test identities.
5. Set friendly provider presentation metadata and enable the provider while retaining a canonical local recovery administrator.
6. Test `/admin-recovery`, remove the test administrator membership while its
   browser/API session remains open, and prove the next authenticated request
   plus refresh both fail. Restore the approved recovery membership only after
   that evidence, then reconcile existing external identities before disabling
   ordinary local login.

Every direct provider session executes step 6 again with fresh upstream
evidence before the session is issued. `sync.triggers` must include `login`
and `sync.requiredForLogin` is always `true`; the direct API, configuration
bundle schema, and portal do not permit turning this off. Authoritative
mappings replace stale provider-managed memberships after an upstream group or
role change, while additive mappings, manual memberships, and memberships from
other providers remain intact. Scheduled LDAP directory reconciliation and
applying saved membership data are additional refresh paths for users who have
not signed in.

An `exists` mapping to a normal internal group represents default access for every authenticated user. Do not configure a provider-level default role.

### Clean-Slate Identity Providers

No customer SSO configuration or mapping exists to migrate. Configure new OIDC,
SAML, or LDAP providers directly in **Identity Providers**, then use **Identity
Mappings** to map validated entitlements to internal groups and normal scoped
role assignments. Do not create legacy provider-to-role or provider-to-engine
mapping rows.

### LDAP

LDAP changes the authentication adapter, not RBAC:

- `direct`: EnterpriseGlue performs bind/search authentication and normalizes LDAP group DNs or attributes.
- `claims_only`: a non-login provider namespace reserved for a separately verified host/plugin integration. EnterpriseGlue 0.11 base routes do not ingest gateway headers or reverse-proxy claims; use `direct` for built-in OIDC, SAML, or LDAP sign-in.

LDAP groups map to the same internal groups used by OIDC and SAML. Store stable group identifiers or normalized DNs, not mutable display labels where a stable id is available.

LDAP direct sign-in binds/authenticates the user, reads their current groups,
and completes the same mandatory reconciliation before a session is issued.
For OIDC providers such as Entra ID, the fresh verified token claims are the
equivalent evidence; SAML uses the verified assertion attributes.

## Configure Engines

### Runtime authorization and sidecar wording

Platform Settings presents runtime enforcement in plain language while JSON and
REST retain stable enum values:

| Portal wording | JSON/API value | What it means |
| --- | --- | --- |
| **EnterpriseGlue only** | `enterpriseglue_authoritative` | EnterpriseGlue makes every authorization decision. Engine-native grants do not create EnterpriseGlue access. |
| **EnterpriseGlue with engine read-access backup** | `mirrored_engine_backstop` | EnterpriseGlue remains authoritative and copies only reviewed group read access to compatible Operaton or Camunda engines after a successful, retained synchronization record. |

A customer-sidecar connection is a separate transport choice, not another
authorization mode. Use `connectionMode: "customer_sidecar"` with
`auth.type: "none"` only for the peer-authenticated sidecar contract: the
customer sidecar authenticates EnterpriseGlue peer-to-peer and owns its
sidecar-to-engine credentials. `none` means EnterpriseGlue stores no downstream
engine credential; it does not mean the sidecar endpoint is public or
unauthenticated. EnterpriseGlue still evaluates access before every sidecar
call.

### Engine tenancy rollout status

Manual and external APIs accept explicit dedicated/shared tenancy. Only the
manual create flow retains omission compatibility: it creates a dedicated
engine in the authenticated request tenant, or `tenant-default` in local OSS.
Every external registration and idempotent external upsert must declare
`tenancy`; an omitted declaration is rejected with HTTP 400 before
EnterpriseGlue reads or writes engine state. Shared mode requires
`resource_aware` and starts in fail-closed `incomplete` state.

Manual/external mapping administration, shared runtime resolution, fail-closed
Runtime Resource Set materialization, and config-bundle topology
preview/apply/diff/export are implemented. Tenant roles, same-tenant
project/dedicated/shared-resource inheritance, portable config assignments,
Current tenant assignment controls, and Effective Access mapping lineage are
implemented. Configuration-owned mapping rows and topology transitions are
also implemented. Engine creation and details now expose guarded topology,
diagnostics, transition acknowledgements, and versioned mapping controls. Do not treat a
shared engine as authorization-ready until diagnostics have no unmapped or
conflicting resources and the rollout evidence is complete. The
migration leaves older tenantless engines in `migration_required`; it does not
silently assign them to the default tenant.

Engine administrators can manage manual mappings in the engine tenancy panel
or through the published API. Use the external mapping example in
[Provision Engines Externally](./provision-engines-externally.md), or the
authenticated manual endpoints documented in
[Engine Tenancy and Provisioning API](../reference/engine-tenancy-and-provisioning-api.md).
Configuration bundles may declare dedicated/shared topology and source-owned
mapping rows through `engine-tenant-mappings.json`. Bundle preview/diff/apply
preserves other ownership sources, resolves stable tenant references, and
schedules runtime reconciliation after mapping changes.

See [Engine Tenancy Data Model](../reference/engine-tenancy-data-model.md) for
the implemented foundation,
[Provision Engines Externally](./provision-engines-externally.md) for API
examples, and [Test Engine Tenancy and Fine-Grained Access Control](../development/testing-engine-tenancy-and-access-control.md)
for the executable shared-engine qualification gates.

For an end-to-end operator workflow, including custom tenant roles and the
required negative access checks, use
[Configure Dedicated and Shared Engine Tenancy](./configure-engine-tenancy.md).
Use
[Diagnose Engine Tenant Resolution](./diagnose-engine-tenant-resolution.md)
for quarantined inventory and
[Upgrade to Explicit Engine Tenancy](./upgrade-engine-tenancy.md) for existing
installations.

Every engine record requires:

- stable key and optional external id;
- name, engine type, base URL, environment, and labels;
- lifecycle and source ownership;
- expected/reported capabilities;
- runtime access scope;
- deployment integration mode;
- `metadataDiscoveryEnabled` (default `true`) to allow scheduled runtime/deployment metadata discovery;
- `pipelineReceiptEnabled` (default `true`) to accept machine-authenticated direct-pipeline deployment receipts;
- connection mode and EnterpriseGlue-to-endpoint authentication.

`metadataDiscoveryEnabled: false` removes the engine from scheduled discovery but does not prevent an administrator from running an explicit manual reconciliation. `pipelineReceiptEnabled: false` rejects the direct-pipeline receipt endpoint for that engine. The receipt switch is relevant only to `direct_engine` deployment integration; EnterpriseGlue-proxy deployments do not use pipeline receipts.

Engine registration never grants human access. Visibility comes from effective scoped permissions.

### Migrate Existing Camunda 7 Grants

For an engine with existing Camunda 7 authorizations, use the dedicated
**Migrate existing Camunda grants** panel rather than copying grants into an
engine configuration or enabling an engine-native authority mode. The first
safe workflow creates new EnterpriseGlue groups and resource-scoped access in
a dedicated additive bundle, while preserving the existing engine row. It
reads `GET /authorization` only and never changes Camunda grants.

Use [Migrate Camunda 7 Native Grants](./migrate-camunda7-native-grants.md)
for prerequisites, Effective Access verification, rollback acknowledgements,
and stop conditions. The API contract and sensitive-detail boundary are in
[Camunda 7 Native-Grant Migration API](../reference/camunda7-native-grant-migration-api.md).

Mission Control and Dashboard engine lists include an engine only when the backend returns at least one authorized runtime resource or an engine-wide runtime read permission. Project deployment dropdowns additionally require project permission, engine deploy permission, an active project-engine target, mode eligibility, lifecycle/capability checks, and policies.

### Report A Direct-Pipeline Deployment

For an engine with `deploymentIntegration = "direct_engine"`, the customer pipeline deploys to the engine itself, then reports the result to EnterpriseGlue. The callback is intentionally machine-authenticated: use an API client or service account that is eligible for the project-engine target's API deployment mode. It is not a browser/UI mutation and does not grant a human user deployment access.

Send one idempotent receipt after the direct deployment succeeds:

```bash
curl --fail-with-body \
  -X POST "$ENTERPRISEGLUE_URL/engines-api/external/engines/$ENGINE_ID/deployment-receipts" \
  -H "Authorization: Bearer $ENTERPRISEGLUE_MACHINE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "idempotencyKey": "ci-run-1842-deploy-7d3f8c1a",
    "projectId": "payments",
    "engineDeploymentId": "operaton-deployment-9281",
    "artifacts": [
      {
        "resourceKind": "process_definition",
        "resourceKey": "payments-approval",
        "version": 12,
        "fileId": "bpmn/payments-approval.bpmn"
      }
    ],
    "lineage": {
      "pipelineRunId": "1842",
      "commitSha": "7d3f8c1a",
      "deploymentName": "payments-approval"
    }
  }'
```

The `idempotencyKey`, project, engine deployment id, and at least one process or decision artifact are required. Repeating the same receipt is safe; the response reports whether it was already recorded. Provide the versioned `fileId` and lineage whenever available: EnterpriseGlue records the receipt as `reported` lineage and can enable Mission Control-Starbase bridge navigation only after the referenced project file/version resolves. A receipt never supplies a sidecar's downstream peer token or changes the customer-sidecar transport contract.

### Customer Sidecar

For a customer-owned sidecar or gateway:

<!-- enterpriseglue-config-schema: ConfigEngineSchema -->
```json
{
  "key": "engine.payments-prod",
  "name": "Payments Production",
  "type": "operaton",
  "baseUrl": "https://payments-sidecar.internal/engine-rest",
  "connectionMode": "customer_sidecar",
  "auth": { "type": "none" },
  "labels": {
    "environment": "prod",
    "domain": "payments",
    "authOwner": "customer"
  }
}
```

`auth.type = none` is allowed only when platform policy permits the
peer-authenticated customer-sidecar contract. It means EnterpriseGlue stores no
sidecar-to-engine credential. It does not make the EnterpriseGlue-to-sidecar
endpoint anonymous: peer-to-peer service-token validation or an equivalent
customer-controlled authenticated channel must protect that hop.

The sidecar-to-engine peer token remains customer-owned. It must never appear in EnterpriseGlue configuration, persistence, OpenAPI, logs, audits, UI, exports, or diagnostics. EnterpriseGlue still performs all authorization before calling the sidecar.

Use the [customer sidecar readiness runbook](./customer-sidecar-readiness-runbook.md)
to validate the private endpoint, upstream authentication, audit boundary, and
rollback plan in the deployed environment.

## Configure Project-Engine Targets

One effective target exists per project/engine pair. Configure allowed modes independently:

- manual deployment;
- CI deployment;
- API deployment;
- import;
- deployment-history visibility.

Config apply cannot create a second row that competes with a manual target. Preview returns skip, conflict, or explicit ownership-transfer options.

## Preview And Apply

The implemented API workflow is:

```text
POST /api/authz/config-bundles/preview
POST /api/authz/config-bundles/diff
POST /api/authz/config-bundles/apply
GET  /api/authz/config-bundles/runs
GET  /api/authz/config-bundles/export?bundleKey=<key>
```

`preview` performs strict bundle validation and returns a canonical hash without mutation. `diff` compares a valid bundle with persisted configuration-managed state. `apply` requires the matching preview hash and records an apply run. `export` returns the source-owned state for one bundle key.

For CI/CD, use the repository CLI rather than hand-writing API requests:

```bash
export ENTERPRISEGLUE_API_URL="https://enterpriseglue.example"
export ENTERPRISEGLUE_API_TOKEN="$EG_CONFIG_TOKEN"

pnpm authz:config validate ./enterpriseglue-config.json
pnpm authz:config preview ./enterpriseglue-config.json
pnpm authz:config apply ./enterpriseglue-config.json
pnpm authz:config export acme-platform-authz
```

The token's principal needs `platform.authz.roles.manage`. `apply` performs its own preview and applies the returned canonical hash, so an edited or stale bundle is rejected. The CLI produces JSON and does not access the database directly.

Preview must report:

- schema/reference failures;
- secret references that cannot be resolved;
- source ownership conflicts;
- role permission changes and affected assignments;
- selector breadth and materialization impact;
- provider mapping membership impact;
- target ownership transfer;
- sensitive or high-risk changes;
- objects to create, update, archive, or leave unchanged.

Apply accepts the preview correlation id and matching bundle hash. It fails closed if state changed after preview or required reconciliation cannot complete.

## Verification

After apply, verify:

- configuration run status and applied hash;
- provider test and reconciliation status;
- group membership and assignment lineage;
- Engine Set and runtime-resource-set materialization;
- engine connection/capability health;
- project-engine target eligibility;
- Effective Access for representative users and machine principals;
- Mission Control, Dashboard, deployment dropdown, and bridge visibility;
- audit records contain lineage but no secrets or identity tokens.

## Rollback

Rollback applies the previous known-good bundle through the same preview/apply path. It does not restore a database dump and does not delete manual, API, identity-provider, or system-owned records merely because they are absent from the bundle.

Provider lockout rollback must also preserve a tested canonical local
administrator on `/admin-recovery` and allow the problematic provider or
mapping to be disabled without deleting unrelated access. The ordinary login
endpoint never bypasses login policy for administrators.

## Implementation Checklist

- [x] ✅ Implement bundle schemas, services, preview/diff/apply/export/history APIs, OpenAPI contracts, authorization metadata, and the API-driven CLI lifecycle.
- [x] ✅ Publish exact UI navigation and the maintained screenshot/evidence set for role editing, Identity, Configuration, engine connection, and diagnostics surfaces.
- [x] ✅ Replace target API notices with the current executable API and CI CLI examples.
- [x] ✅ Add schema-validated headless OIDC and direct/shared/customer-sidecar engine examples, including the current engine registration options.
- [x] ✅ Validate every executable JSON example in these how-to guides in CI against the shared Zod schemas; validate engine API examples through the OpenAPI contract suite.
