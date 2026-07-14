# Configure Authorization, Identity, And Engines

Summary: Target operator workflow for configuring EnterpriseGlue roles, groups, identity mappings, engines, Engine Sets, runtime-resource access, and project-engine targets.

Audience: Platform administrators, identity administrators, engine operators, and deployment engineers.

Status: **Incremental implementation guide for the RBAC/config refactor.** Platform Settings, Access Control, SSO, Engines, JSON bundle preview/apply/export, runtime-resource sets, provider-neutral identity mapping foundations, and engine ingestion controls are implemented in this worktree. Customer-sidecar transport, provider API reconciliation for every protocol, deployment startup automation, and other unchecked roadmap items remain target work; use only the documented implemented routes/settings in production.

Current UI progress: Access Control includes modular Effective Access, SSO diagnostics, assignment-source ownership tags, and role-assignment form logic isolated for continued component extraction. See the live implementation tracker in [the architecture plan](../architecture/11-json-driven-authz-and-engine-registration.md).

Related design:

- [Authorization and Access Control](../architecture/09-oss-authorization-access-control-model.md)
- [JSON-Driven Authorization and Engine Registration](../architecture/11-json-driven-authz-and-engine-registration.md)
- [Deploy Authorization Configuration](./deploy-authorization-config.md)

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
| User authentication | `standalone`, `transition_to_sso`, `sso_enforced` | Start with `standalone`; retain a break-glass local admin during transition |
| Identity protocol | Local, OIDC, SAML, LDAP direct, LDAP claims-only | OIDC when available; map all protocols through provider-neutral entitlements |
| Engine access authority | `manual`, `transition_to_sso`, `sso_managed` | `manual` for standalone, then explicit transition |
| Project access authority | `manual`, `transition_to_sso`, `sso_managed` | `manual` unless projects are centrally governed |
| Engine onboarding | `manual_allowed`, `external_only`, `hybrid` | `manual_allowed` for local use; `external_only` for registry-controlled estates |
| Project-engine targets | `manual`, `external`, `hybrid` | `hybrid` when projects remain local but targets are partly centrally managed |
| Runtime scope | `engine_wide`, `resource_aware` | `engine_wide` for distributed engines; `resource_aware` only for central engines |
| Engine connection | `direct`, `customer_sidecar` | `direct`; select `customer_sidecar` only for an explicit customer gateway endpoint |

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

UI and JSON changes use the same source ownership rules. A config-owned field is not silently overwritten by a manual UI edit.

### JSON Bundle

The target folder layout is:

```text
enterpriseglue-config/
  enterpriseglue.json
  roles.json
  groups.json
  identity-providers.json
  identity-mappings.json
  engines.json
  engine-sets.json
  runtime-resource-sets.json
  assignments.json
  project-engine-targets.json
  policies.json
```

`enterpriseglue.json` declares schema version, bundle id, imports, expected object files, and optional expected hash. Secret values are never stored in this folder; provider and engine objects contain secret references only.

Every configurable object has a stable `key`. Config apply resolves keys to database ids, records `source = config`, `sourceRef`, source hash, apply run, and ownership mode, then runtime authorization reads the database.

### CI/CD

CI/CD should perform these steps:

1. Validate schema and references without database mutation.
2. Preview against the target environment.
3. Review the create/update/archive/conflict and effective-access impact.
4. Apply the exact preview using its correlation id and bundle hash.
5. Wait for identity, Engine Set, runtime-resource-set, and target reconciliation.
6. Verify readiness, expected hash, and no unresolved high-risk drift.
7. Retain the previous bundle and apply receipt for rollback.

See [Deploy Authorization Configuration](./deploy-authorization-config.md) for the implemented API/CLI workflow and the remaining bootstrap-deployment work.

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
5. Enable the provider while retaining a break-glass local administrator.
6. Reconcile existing external identities before enforcing SSO.

An `exists` mapping to a normal internal group represents default access for every authenticated user. Do not configure a provider-level default role.

### Legacy Provider Transition

The Identity Providers UI can prepare a disabled direct-OIDC draft from a
legacy persisted Microsoft, Google, or OIDC provider, or from the legacy
Microsoft/Google environment settings. The draft preserves non-secret metadata
only and requires an external secret reference, identity mappings, callback
registration, a controlled sign-in test, and a manual legacy-provider cutover.

Before disabling a compatibility provider, use its **Check migration readiness**
row action. Readiness is non-mutating and fails until the provider exists, uses
direct OIDC, is enabled, has an available secret reference, and has at least one
active identity mapping. Automatic archival is deliberately unavailable because
the legacy provider may be platform-global while the replacement is tenant
scoped. See [Auth and SSO Setup](./auth-sso.md#migrate-a-legacy-microsoft-google-or-oidc-provider)
for the controlled runbook and rollback sequence.

### LDAP

LDAP changes the authentication adapter, not RBAC:

- `direct`: EnterpriseGlue performs bind/search authentication and normalizes LDAP group DNs or attributes.
- `claims_only`: a trusted upstream login layer authenticates the user and provides verified identity attributes.

LDAP groups map to the same internal groups used by OIDC and SAML. Store stable group identifiers or normalized DNs, not mutable display labels where a stable id is available.

## Configure Engines

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

Mission Control and Dashboard engine lists include an engine only when the backend returns at least one authorized runtime resource or an engine-wide runtime read permission. Project deployment dropdowns additionally require project permission, engine deploy permission, an active project-engine target, mode eligibility, lifecycle/capability checks, and policies.

### Customer Sidecar

For a customer-owned sidecar or gateway:

```json
{
  "key": "payments-prod",
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

`auth.type = none` is allowed only when platform policy permits a private credentialless customer-sidecar endpoint. Prefer mTLS, API-key references, or OAuth credentials for the EnterpriseGlue-to-sidecar hop when supported.

The sidecar-to-engine peer token remains customer-owned. It must never appear in EnterpriseGlue configuration, persistence, OpenAPI, logs, audits, UI, exports, or diagnostics. EnterpriseGlue still performs all authorization before calling the sidecar.

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

Provider lockout rollback must also preserve a tested local break-glass administrator and allow the problematic provider or mapping to be disabled without deleting unrelated access.

## Implementation Checklist

- [x] ✅ Implement bundle schemas, services, preview/diff/apply/export/history APIs, OpenAPI contracts, authorization metadata, and the API-driven CLI lifecycle.
- [ ] ⬜ Add screenshots and exact UI navigation after the role editor, Identity, Configuration, Engine connection, and diagnostics surfaces are complete.
- [x] ✅ Replace target API notices with the current executable API and CI CLI examples.
- [ ] ⬜ Add tested standalone, OIDC, SAML, LDAP, distributed-engine, central-engine, external-registration, and customer-sidecar examples.
- [ ] ⬜ Validate every documented example in CI against shared Zod/OpenAPI schemas.
