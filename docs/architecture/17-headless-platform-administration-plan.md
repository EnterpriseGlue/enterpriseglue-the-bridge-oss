# Headless Platform Administration Plan

## Outcome

EnterpriseGlue must be deployable and administrable from reviewed configuration
without requiring an interactive administrator or the Admin UI. The portal
remains an optional inspection and diagnostics surface. Durable settings and
catalog records use the same canonical schemas, validation, persistence,
authorization boundaries, audit evidence, and rollback rules regardless of
whether they are supplied by the portal, API, CLI, or startup bootstrap.

This plan extends the existing `EnterpriseGlueConfigBundle` lifecycle rather
than introducing a second configuration format. Operators continue to use
strict preview, secret preflight, semantic diff, exact-hash apply, export,
idempotency, startup reconciliation, and source-scoped authoritative cleanup.

## Reuse Versus New Work

The following 0.11.1 foundations remain authoritative and should not be
reimplemented:

- the `enterpriseglue.ai/v1beta1` manifest and bounded `{ bundle, files }`
  transport envelope;
- strict Zod compilation, canonical semantic hashing, cross-file reference
  validation, and sanitized validation issues;
- preview, secret preflight, diff, exact-hash apply, export, ZIP import, apply
  runs, idempotency, and CI provenance;
- `additive`, `authoritative`, and `preview_only` modes;
- `config_locked`, `config_warn`, and `manual` ownership behavior;
- tenant-scoped apply, source-scoped archive, stored-identity replay, runtime
  reconciliation, audit evidence, and fail-closed startup bootstrap;
- existing files for engines, engine mappings, Engine Sets, runtime-resource
  sets, roles, groups, assignments, identity providers/mappings, and project
  deployment targets.

The change adds object-family adapters to that pipeline. It does not add a
generic database patch language, an unauthenticated administration endpoint,
or one environment variable per setting. The existing Admin APIs remain the
interactive contract, while their service layer and the bundle apply layer
share the same validators and transactional mutation primitives.

## Boundary

"Administrative configuration" means durable policy or catalog state that an
administrator can intentionally reproduce in another installation. It does not
include operational history or human activity.

Included:

- platform behavior and deployment defaults;
- invitation-domain and PII-redaction policy;
- platform branding;
- environment tags and their order/default;
- Git provider definitions and sync policy;
- email delivery configurations and email templates;
- identity providers and mappings;
- engines, tenancy, runtime-resource catalogs, and deployment targets;
- roles, permissions, groups, assignments, authorization policies, and machine
  principals;
- external-engine system registrations that authorize provisioning clients.

Excluded because they are runtime state or privileged operations:

- audit logs, diagnostics, health samples, apply history, and deployment
  receipts;
- users, active sessions, password-reset state, invitations in flight, and
  provider-normalized identities;
- connection tests, secret rotation, reconciliation triggers, one-off previews,
  and destructive migration actions;
- projects and model content, which are tenant workload data rather than
  platform configuration.

The exclusion of users does not require an interactive administrator for
configuration apply. Startup bootstrap applies as the bounded system actor.
Administrator recovery remains a separate break-glass control and no password
or recovery credential is accepted in a configuration bundle.

## Implemented Parity Inventory

| Admin surface | Canonical persistence/API | Current bundle coverage | Target |
| --- | --- | --- | --- |
| Governance modes and login policy | `PlatformSettings` | Aligned | Preserve |
| Engines and tenancy | `Engine`, mappings, sets, runtime resources | Aligned | Preserve |
| Identity providers and mappings | Provider-neutral identity entities | Aligned | Preserve |
| Roles, groups, scoped assignments | RBAC entities | Aligned, including custom permission definitions | Preserve |
| Project deployment targets | `ProjectEngineTarget` | Aligned | Preserve |
| General platform defaults | `PlatformSettings` | Aligned | Preserve |
| Invite-domain policy | `PlatformSettings` | Aligned | Preserve |
| PII redaction | `PlatformSettings` | Aligned with secret references | Preserve |
| Branding | `PlatformSettings` branding fields | Aligned | Preserve |
| Environment tags | `EnvironmentTag` | Aligned | Preserve |
| Git providers and sync policy | `GitProvider`, `PlatformSettings` | Aligned with secret references | Preserve |
| Email delivery | `EmailSendConfig` | Aligned with secret references | Preserve |
| Email templates | `EmailTemplate` | Aligned with bounded templates | Preserve |
| Authorization policies | `AuthzPolicy` | Aligned | Preserve |
| API clients and service accounts | machine-principal entities | Aligned without exposing generated secrets | Preserve |
| External engine systems | `ExternalEngineSystem` | Aligned | Preserve |
| Audit/diagnostic tabs | read-only evidence | Not applicable | Remain read-only |

Every row added by this change must be reported as `aligned`, `not applicable`,
or `gap` by the maintained contract-parity test. A generated OpenAPI schema
alone is not alignment evidence.

## Persistence And Concurrency

`PlatformSettings` contains independent policy domains that may have different
owners. A single all-settings lock would make an engine-governance bundle own
email, branding, or PII accidentally. Add a portable section-ownership entity
keyed by settings row and section (`governance`, `login`, `git_sync`,
`deployment`, `invitations`, `pii`, and `branding`). Seed the governance row
from the existing provenance columns and continue exposing the existing
governance response fields during the compatibility window.

Environment Tags store provenance directly because their stable config key is
also part of the public resource. The remaining newly supported catalog
families use `AdminConfigObjectOwnership`, keyed by object type, object ID,
scope, configuration key, and source. That generic ledger records source hash,
ownership mode, drift, active state, secret references, generation, and apply
time without adding configuration columns to unrelated legacy tables. TypeORM
migration `1700000000110` creates both ownership ledgers and qualifies their
schema on every supported adapter.

Preview records the exact current generation used for each proposed mutation.
Apply reclaims the same row/section transactionally and rejects a changed
generation, owner, tenant, or security-relevant field before any write.
Interactive mutation claims that same row and either rejects `config_locked`
or marks `config_warn` drift in the mutation transaction. This prevents stale
bundle apply from overwriting a concurrent administrator action.

## Configuration Contract

The bundle manifest remains `enterpriseglue.ai/v1beta1`. Optional imports keep
engine- or identity-only bundles from silently claiming unrelated platform
configuration:

```text
./platform-settings.json
./environment-tags.json
./git-providers.json
./email-configurations.json
./email-templates.json
./permissions.json
./authorization-policies.json
./machine-principals.json
./external-engine-systems.json
```

Each file has a strict shared Zod schema, stable configuration keys, bounded
string/array/document sizes, explicit defaults, and an ownership mode. Unknown
fields, duplicate keys, unknown references, mixed tenant ownership, and literal
credentials fail before persistence.

The general settings file groups related fields without mirroring database
column names:

```json
{
  "platformSettings": {
    "ownershipMode": "config_locked",
    "general": {
      "defaultEnvironmentTagKey": "environment.development",
      "emailPlatformName": "EnterpriseGlue"
    },
    "gitSync": {
      "pushEnabled": true,
      "pullEnabled": false,
      "projectTokenSharingEnabled": false
    },
    "deployment": {
      "defaultDeployRoles": ["owner", "delegate", "operator"],
      "credentiallessCustomerSidecarsEnabled": false
    },
    "invitations": {
      "allowAllDomains": false,
      "allowedDomains": ["example.com"]
    },
    "pii": {
      "regexEnabled": true,
      "externalProviderEnabled": false,
      "externalProviderType": null,
      "externalProviderEndpoint": null,
      "externalProviderAuthHeader": null,
      "externalProviderAuthTokenRef": null,
      "externalProviderProjectId": null,
      "externalProviderRegion": null,
      "redactionStyle": "<TYPE>",
      "scopes": ["processDetails", "history", "logs", "errors", "audit"],
      "maxPayloadSizeBytes": 262144
    },
    "branding": {
      "logoUrl": null,
      "loginLogoUrl": null,
      "logoTitle": "EnterpriseGlue"
    }
  }
}
```

The final schema owns the complete validated setting set, including bounded
branding typography and colors. The abbreviated example is not the schema.

## Ownership And Drift

- `config_locked` rejects interactive or ordinary API mutations before writes.
- `config_warn` permits an authorized emergency mutation and marks the exact
  object drifted.
- `manual` preserves ordinary API/portal ownership.
- Authoritative cleanup may archive only objects previously owned by the same
  bundle and tenant. Absence never removes manual, another-bundle, or runtime
  state.
- Moving or releasing ownership uses a preview/hash/idempotency receipt. Direct
  database ownership edits are unsupported.
- Settings and resources use monotonic generation or exact-field transaction
  claims so a concurrent portal edit cannot be overwritten by stale apply.

## Secrets And Outbound Trust

- Bundle values never contain credentials, bearer tokens, private keys,
  certificates, SMTP passwords, OAuth client secrets, or PII-provider tokens.
- Secret-bearing fields accept only approved `env://`, `file://`, or
  `docker://` references and use the existing canonical-path and projected
  Secret protections.
- The authorized preflight response identifies submitted references so an
  operator can repair the bundle. Retained audit/run evidence stores only
  counts, stable reason codes, and a blind correlation commitment—never the
  reference, path, free-form reason, or secret value.
- Exports retain safe references only where the caller is authorized to export
  that configuration and the safe reference metadata still exists. Export
  fails closed rather than inventing a write-only placeholder when the caller
  lacks permission or the reference metadata is unavailable.
- Headless apply itself does not contact configured Git or PII endpoints. At
  runtime, Git OAuth/API and external PII calls pass through the centralized
  administrator-integration endpoint boundary: production HTTPS, reviewed
  hosts, DNS/private-address validation and address pinning, no redirects,
  bounded bodies, deadlines, and sanitized errors. Email, identity, and engine
  calls retain their existing service-specific boundaries.
- Machine credentials are supplied through secret references and stored only as
  the existing one-way verification material. Apply/export never returns a
  generated credential.
- Configuration-bundle apply is a high-privilege capability: a machine
  principal that can apply a bundle can change bundle-managed machine
  principals, roles, and assignments, including its own declared state. The
  exact-hash preview, required acknowledgements, protected branch review, and
  apply audit are therefore part of the trust boundary. Use startup bootstrap
  for first installation and a separately reviewed, least-privilege pipeline
  identity for later changes; do not treat the coarse token scope alone as an
  authorization boundary.

## Startup Without An Administrator

The existing bounded startup contract remains authoritative:

```text
EG_CONFIG_BUNDLE_PATH
EG_CONFIG_BOOTSTRAP_MODE=validate|apply
EG_CONFIG_EXPECTED_SHA256
EG_CONFIG_EXPECTED_TENANT_SCOPE
EG_CONFIG_MAX_BYTES
```

Startup reads only the configured local file/archive, verifies the optional
expected hash, compiles every imported file, preflights all secret references,
and applies through the same transaction-aware services as the API. `apply`
fails readiness when validation, secret resolution, tenant scope, ownership,
or persistence fails. It does not fall back to partial defaults.

No administrator access token is required. The apply receipt identifies the
bounded bootstrap actor, source hash, source revision when supplied, affected
object types, and sanitized issue codes. No raw bundle or secret value is
stored in audit details.

## Implemented Rollout Order

1. Added the parity inventory and strict file schemas.
2. Added general Platform Settings, branding, and environment tags.
3. Added Git and email integrations with secret references.
4. Added authorization policies, custom permissions, machine principals, and
   external-engine systems.
5. Extended preview, diff, secret preflight, apply, export, ownership, archive,
   and startup reconciliation for every family.
6. Made portal mutations ownership-aware and exposed read-only lineage/drift.
7. Published complete examples, API metadata, operator runbook, upgrade/rollback, and
   contract tests.

The release is not complete while any included row in the parity inventory is
still a gap.

Implementation can be reviewed as ordered commits or stacked internal branches,
but the public contract should ship as one 0.12 feature boundary. Do not publish
an intermediate release in which a file validates but diff/apply/export or
portal ownership is incomplete.

## Release Gates

- configuration-bundle schema/preview/diff/apply/export/rollback suites;
- literal-secret, unavailable-secret, cross-tenant, stale-hash, competing-owner,
  and concurrent-edit negative tests;
- startup validate/apply/failure readiness rehearsals without any administrator
  session;
- route/OpenAPI, portal ownership, example, and documentation contracts;
- TypeORM migration portability and all supported database adapters if durable
  schema changes are introduced;
- package compatibility, typecheck, and release-note preflight;
- one clean-install headless deployment that reaches readiness, exposes the
  expected public branding/login contract, and proves every durable admin
  setting from the exported bundle.
