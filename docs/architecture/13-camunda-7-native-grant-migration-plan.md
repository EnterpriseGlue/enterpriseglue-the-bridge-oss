# Camunda 7 Native Grant Migration Plan

Last updated: 2026-07-24

Status: Implemented; local release qualification is determined only by the
current clean-commit release-evidence index. Customer adoption remains an
operational change-management activity, not a product-release blocker.

## Decision

For the first customer migration, EnterpriseGlue will provide a **read-only
Camunda 7 native-grant inventory, mapping preview, and approved import into
EnterpriseGlue authorization configuration**. It will not enable
`engine_native_authority`.

The resulting EnterpriseGlue configuration remains the human-access source of
truth and uses the existing `enterpriseglue_authoritative` runtime mode. Native
Camunda grants remain unchanged unless a later, separately approved
backstop/mirroring project writes to Camunda.

This is intentionally a migration tool, not a second permanent permission
editor. It solves the customer adoption problem without making EnterpriseGlue
depend on Camunda's user/group/grant model at runtime.

## Implemented Foundation

The first implementation slice provides the versioned, bounded native-grant
input/export contract and a Camunda 7-only inventory adapter. The live adapter
uses paginated `GET /authorization` requests exclusively and performs a
one-record completeness probe when it reaches its 5,000-record ceiling; a
truncated inventory cannot become an approved draft.

The initial mapping catalogue is deliberately narrow and versioned as
`camunda7-v1-read-only`: an exact, active, unambiguous group `READ` grant on a
process-definition or decision-definition with resolved runtime inventory is
the only automatically proposed candidate. Broad `*` grants require explicit
approval. User grants, global grants, revokes, unsupported resources,
unmapped permissions, missing resources, and unresolved/ambiguous inventory
are retained as manual or blocked items. No native authorization is written,
and this slice does not introduce a runtime authority mode.

The foundation also persists an import-run receipt across all supported
database adapters. Ordinary history stores only the source hash, normalized
counts, mapped-action IDs, and opaque source/group/resource references. The
optional detailed native snapshot is encrypted, permission-gated by the later
API/UI workflow, and automatically eligible for removal after a maximum of
30 days; expiry removes that encrypted detail but retains the sanitized audit
receipt and any resulting configuration-bundle apply reference.

The local `test/e2e/mock-camunda` fixture now exposes a synthetic Camunda 7
`GET /authorization` catalogue, including exact process/decision group grants,
an acknowledged broad grant, a direct-user grant, a revoke, and an unsupported
task grant. Its pagination test verifies that no fixture route accepts a native
authorization write, so local translation tests do not need customer data or
an IdP connection.

For exact supported grants, the implementation produces a deterministic,
dedicated additive configuration-bundle draft. It references the already
registered engine by a controlled internal reference rather than copying its
connection, tenancy, or ownership into `engines.json`; this applies equally to
engines first added through the UI, API, or another config bundle. It adds only
new selected EnterpriseGlue groups, a least-privileged engine read role, exact
Runtime Resource Sets, and scoped group assignments. It preserves
`enterpriseglue_authoritative`, cannot replace a resource-specific grant with
an engine-wide one, and refuses missing mappings, unknown action mappings,
duplicate generated keys, or an invalid resulting bundle. Broad, user-specific,
revoke/global, unsupported, and blocked records remain outside that draft as
manual work.

The reviewed encrypted draft is now applied by a dedicated engine route that
requires configuration-bundle apply permission, verifies the stored hash,
uses an idempotency receipt, and writes the resulting apply-run id back to the
sanitized import record. A rollback preview creates an authoritative empty
version of the same dedicated migration bundle; after normal archive
acknowledgements it retires only records owned by that import bundle. Neither
apply nor rollback writes to Camunda or changes the engine registration.

The local release gate includes an authenticated Chromium workflow against the
Docker frontend/backend, PostgreSQL, and the synthetic Camunda fixture. It
exercises read-only inventory, sanitized preview then protected mapping,
hash-bound draft/apply, production identity-source synchronization of a
synthetic group claim, process and decision target allows plus sibling deny
through Effective Access and protected Mission Control routes, reload/resume,
and hash-bound rollback followed by denial. The runner invokes the same durable
runtime reconciliation service used by the backend worker because the ordinary
local stack does not run that poller continuously. Its sanitized same-commit
receipt is required by the release-evidence index. This provides product
evidence without customer identities, customer grants, or a deployed customer
IdP.

## Summary of the Agreed Model

### Engine registration and tenancy

- New engines must eventually declare tenancy explicitly on every registration
  surface. The compatibility fallback is a provisioning-only behavior and must
  be removed before broad external adoption.
- An engine created through the current EnterpriseGlue UI already submits
  explicit `dedicated` tenancy with the current tenant. Removing the omitted
  tenancy fallback does not require that engine to be deleted or re-added.
- Before the cutover, an operator confirms the existing engine has
  `tenancyMode = dedicated`, a persisted `tenantId`, and resolution status
  `ready` in the **Tenancy and tenant mappings** panel.
- The normal decentralized default remains `dedicated + engine_wide +
  enterpriseglue_authoritative`.

### Runtime access scope

`dedicated`/`shared` describe engine ownership; `engine_wide`/
`resource_aware` describe the granularity of runtime access. They are not the
same setting.

```text
dedicated engine -> one EnterpriseGlue tenant
                   -> engine_wide or resource_aware

shared engine    -> multiple EnterpriseGlue tenants by runtime resource
                   -> resource_aware only
```

For a central/shared Camunda 7 engine, ordinary users receive scoped access to
runtime resource sets rather than whole-engine grants. A platform operator may
hold a deliberately broad whole-engine role. A dedicated engine can also use
`resource_aware` when one customer wants internal separation between processes
or decisions; it does not become shared merely because that scope is selected.

### Authority mode

The default mode is `enterpriseglue_authoritative`:

```text
verified identity -> EnterpriseGlue group -> scoped role -> route decision
                 -> configured technical/sidecar identity -> Camunda 7
```

EnterpriseGlue does not currently write or consume native Camunda grants as
the human-access decision. Camunda's configured technical identity must still
have enough technical permission to execute calls that EnterpriseGlue already
allowed; a Camunda rejection fails the request safely.

The optional `mirrored_engine_backstop` is now implemented for the narrow,
Camunda 7/Operaton exact-group `READ` subset, reached directly or through a
customer-owned sidecar. EnterpriseGlue is still the editor and final product
evaluator; the backstop is a separate engine-access defence layer, not a
native-grant import. `engine_native_authority` remains deferred: it would require an
ongoing, authoritative reconciliation of native Camunda identities, groups,
grants, revokes, tenant checks, resource identifiers, and EnterpriseGlue
project/SSO context.

## Why an Import Tool Is Preferred to `engine_native_authority`

Camunda 7 has native grant/revoke records for a user or group, a resource type
and a resource id. It can apply precedence between global, group, user, grant,
and revoke records. That model is useful inside Camunda, but it is not a
drop-in EnterpriseGlue runtime authority:

- EnterpriseGlue normally reaches Camunda with a technical or sidecar identity,
  so Camunda does not necessarily see the actual EnterpriseGlue user/groups.
- Camunda resource/permission semantics do not map one-for-one to
  EnterpriseGlue route actions, project checks, policies, or resource sets.
- Native global grants, revokes, direct user grants, task/instance grants, and
  Cockpit/application permissions can be more specific than the v1
  EnterpriseGlue resource boundary.
- Maintaining native and EnterpriseGlue editors indefinitely creates silent
  divergence and confusing support ownership.

The importer preserves the valuable customer investment: it reads and explains
their existing grants, proposes equivalent EnterpriseGlue configuration, and
requires an administrator to approve the result. It never broadens access just
because a native grant cannot be represented.

## Target User Experience

The tool appears on a Camunda 7 engine's Access Control / tenancy view as
**Migrate existing Camunda grants**. It is available only to an operator with
the dedicated native-grant migration permission and only for a `camunda7`
engine with successful connection and runtime-inventory discovery.

1. **Inventory** — make a read-only, paginated request for native Camunda
   authorizations and the relevant process/decision/tenant inventory.
2. **Classify** — show supported, approval-required, and unsupported items;
   do not make any changes.
3. **Map** — with the separate sensitive-detail permission, map a Camunda
   group to a new EnterpriseGlue internal group in a dedicated migration
   bundle. Existing-group reuse remains a separately reviewed config change in
   the initial safe UI flow.
4. **Preview** — generate and persist a deterministic configuration draft
   containing groups, roles, Runtime Resource Sets, and assignments.
5. **Approve and apply** — configuration-bundle apply permission is required;
   the server applies only the reviewed stored hash and records its receipt.
6. **Verify** — compare selected known user/group/resource allow/deny cases in
   Effective Access and retain the sanitized result.
7. **Rollback when needed** — preview the import-owned records to archive,
   acknowledge the authoritative removals, then apply the hash-bound rollback.

The UI must state clearly that the import **does not alter Camunda grants** and
that future changes must be made in EnterpriseGlue after the cutover.

## Proposed Architecture

```text
Camunda 7 Authorization API / customer-supplied export (read only)
  -> CamundaNativeAuthorizationInventoryAdapter
  -> normalizer and capability classifier
  -> mapping preview and exception report
  -> deterministic EnterpriseGlue config-bundle draft
  -> existing config preview/diff/effective-access/apply pipeline
  -> EnterpriseGlue groups, roles, Runtime Resource Sets, assignments
```

The importer is an engine-adapter capability. It must not be implemented as a
generic database reader, must not query Camunda system tables directly, and
must not add an alternate authorization check to Mission Control routes.

When an installed Camunda 7 instance cannot grant read-only authorization
enumeration, the importer accepts a signed/sanitized customer export with the
same schema. The export is validated locally and gets the same preview; it is
not trusted as runtime authorization data.

### Reuse of Existing EnterpriseGlue Building Blocks

- Engine connection policy, secret references, allowlisted hosts, timeouts,
  TLS verification, redaction, and audit transport.
- Runtime-resource discovery and the canonical process/decision key plus
  runtime-tenant inventory.
- EnterpriseGlue internal groups, custom roles, role assignments, Runtime
  Resource Sets, Effective Access, and configuration bundle preview/apply.
- Tenant mapping and fail-closed shared-engine resource resolution.
- Engine topology transition preview/apply. The importer proposes but does not
  silently change `engine_wide` to `resource_aware`.

## Translation Rules

Translation is conservative. A record is automatically proposed only if it is
allow-only, has an unambiguous EnterpriseGlue target, and can be represented by
the selected role/action mapping. Any missing inventory, identity match,
tenant mapping, permission mapping, or ownership decision is a stop condition.

| Camunda 7 native input | EnterpriseGlue candidate | Default treatment |
| --- | --- | --- |
| Group grant on an exact process-definition key | Existing/new EnterpriseGlue group, role, process Runtime Resource Set | Proposed for review |
| Group grant on an exact decision-definition key | Existing/new EnterpriseGlue group, role, decision Runtime Resource Set | Proposed for review |
| Grant whose key has one resolved runtime tenant | Add that runtime tenant constraint to the candidate set | Proposed for review |
| Group grant on `*`/all resources | No automatic v1 equivalent | Visible as `approval_required`; it is not included in the initial exact-resource draft |
| Multiple compatible native grants for one group/key | One candidate group/set/assignment with the union of selected mapped actions | Proposed for review |
| User-specific grant | Explicit EnterpriseGlue identity-link mapping required | Manual mapping required |
| Global grant, revoke, or precedence-dependent result | No automatic equivalent | Inventory only; manual policy decision required |
| Task, process-instance, deployment, batch, filter, application, or administration grant | No automatic v1 equivalent | Inventory only; manual policy decision required |
| Native tenant administration grant | Not equivalent to runtime tenant access | Inventory only; manual policy decision required |
| Unknown resource, permission, malformed id, or inactive inventory item | None | Blocked and reported |

The importer does not translate raw Camunda permission names directly into
product access. It uses a versioned, tested mapping catalogue from a native
resource/permission pair to one or more EnterpriseGlue action permissions. The
catalogue must name any intentional loss of capability and require approval for
action expansion. Default role templates remain least-privileged; an operator
may select a broader role only with an explicit acknowledgement.

For a shared engine, a candidate requires a current runtime resource with
exactly one resolved EnterpriseGlue tenant. The default tenant is never
inferred. For a dedicated engine, the importer can propose `resource_aware`
when the customer has per-process/per-decision grants; the operator must use
the existing topology/scope preview before applying it.

## Data, API, and Ownership Design

### Stored import evidence

Add an import-run record with:

- engine id and engine adapter/version/capability snapshot;
- source kind (`live_api` or `customer_export`), observed time, input hash,
  normalized counts, and sanitized status;
- a short-lived encrypted detailed snapshot or a customer-export reference;
- mapping-catalog version, resulting draft hash, approver, apply result, and
  rollback reference; and
- sanitized per-item classification and reason codes.

Raw user IDs, group names, tokens, endpoint URLs, and native authorization
payloads must not enter generic logs, browser telemetry, normal audit details,
or ordinary list responses. The detailed preview is permission-gated, encrypted
at rest, and expires after the documented migration retention period. Retained
audit evidence uses opaque source references and counts/hashes.

### Generated configuration

The approved result is a deterministic configuration-bundle draft rather than
a hidden second persistence path. It contains stable keys for:

- imported EnterpriseGlue groups;
- role definitions or explicitly selected existing role references;
- Runtime Resource Sets with engine, process/decision, and runtime-tenant
  selectors; and
- group role assignments at the resulting resource-set or engine scope.

The resulting rows use the ordinary `config_bundle:<migration-key>` source
reference; the import-run record links to the configuration apply receipt and
keeps raw source detail encrypted. A dedicated migration key makes rollback
ownership exact. Existing source-ownership rules still apply: an import cannot
overwrite manual, API, SSO, or unrelated config-owned records.

### Endpoints

Use an engine-scoped, explicit workflow:

```text
POST /engines-api/engines/:id/camunda-native-grants/imports/preview
GET  /engines-api/engines/:id/camunda-native-grants/imports
GET  /engines-api/engines/:id/camunda-native-grants/imports/:runId
GET  /engines-api/engines/:id/camunda-native-grants/imports/:runId/detail
POST /engines-api/engines/:id/camunda-native-grants/imports/:runId/draft
POST /engines-api/engines/:id/camunda-native-grants/imports/:runId/apply
POST /engines-api/engines/:id/camunda-native-grants/imports/:runId/rollback/preview
POST /engines-api/engines/:id/camunda-native-grants/imports/:runId/rollback
```

The preview receives only safe source options. It returns a bounded classified
inventory and expiry. The collection route returns at most 50 newest-first,
tenant-scoped sanitized receipts so an applied migration can be safely resumed
for rollback after a UI reload. The sensitive detail route is separately permission-gated.
The draft and apply routes retain and apply the exact generated configuration;
they do not accept a browser-supplied replacement configuration. Rollback has
its own no-change preview and applies only the returned rollback hash with the
normal authoritative-archive acknowledgements.

Add dedicated permissions for preview, sensitive-preview view, draft creation,
and audit/history read. These must be separated from ordinary engine edit and
secret-view permissions.

## Implementation Work Packages

### 0. Customer discovery and decision record

- Confirm the test engine is `dedicated`, has a resolved tenant, and uses the
  desired access scope.
- Obtain a read-only Camunda 7 authorization export/API sample, engine version,
  native identity source, direct Cockpit/API usage, and a list of representative
  users/groups/processes/decisions.
- Agree whether direct Camunda access will remain during migration and who owns
  the final EnterpriseGlue configuration.
- Produce a mapping workbook of supported and manual items before writing any
  production record.

**Done when:** customer and EnterpriseGlue agree on a bounded native-grant
sample, target groups, target roles, direct-access posture, and success cases.

### 1. Contracts and adapter capability

- Define the normalized native-authorization input schema, classifier output,
  reason codes, import-run/draft schemas, OpenAPI, and permission actions.
- Add import-run persistence, encrypted preview retention, and cleanup through
  the canonical entity/migration registries for PostgreSQL, MySQL, SQL Server,
  Oracle, and Spanner. Migration bootstrap, idempotency, identifier limits,
  and cleanup fixtures are part of this work package.
- Extend only the Camunda 7 adapter with paginated, read-only authorization
  inventory capability; record unsupported API/version capability explicitly.
- Add a validated customer-export format for installations where enumeration is
  unavailable.
- Add redaction/retention policy and migration audit events.
- Create the disposable synthetic Camunda 7 native-grant fixture catalogue
  described below. It is a required test asset, not an optional demo.

**Done when:** no raw native payload can be applied or logged, and every
adapter/API limitation has a visible, stable diagnostic.

### 2. Inventory and conservative classifier

- Implement live/export ingestion, normalization, duplicate handling, stable
  hashing, and capability checks.
- Join exact process/decision identifiers to active EnterpriseGlue runtime
  inventory. Require one resolved tenant on shared engines.
- Classify every input record as `proposed`, `approval_required`,
  `manual_required`, or `blocked`; never silently discard an input item.
- Provide a read-only UI/report with counts, mappings, and manual work.

**Done when:** an operator can prove the disposition of every native record
without modifying either Camunda or EnterpriseGlue authorization.

### 3. Mapping catalogue and config-draft generator

- Implement the versioned Camunda-resource/permission to EnterpriseGlue-action
  catalogue with unit-tested, least-privileged templates.
- Build the protected group mapping UI, dedicated new-group bundle flow, role
  selection, exact process/decision selectors, and broad-grant acknowledgements.
- Generate deterministic config-bundle drafts and submit them to existing
  preview/diff/Effective Access services.
- Detect ownership conflicts and require a normal config conflict resolution;
  never overwrite an unrelated assignment.

**Done when:** the same native snapshot plus selections produces the same draft
hash and can be fully reviewed before apply.

### 4. Controlled apply, verification, and rollback

- Apply only through the hash-bound stored configuration path and record the
  resulting configuration apply receipt on the import run.
- Before apply, require a current engine topology/scope preview when the draft
  needs `resource_aware` access; transition/scope changes are a separate
  acknowledged operation.
- Add a comparison runner for selected representative cases: expected native
  result, imported EnterpriseGlue result, and post-apply Effective Access.
- Generate a reverse authoritative config preview from the dedicated migration
  bundle. Rollback removes only import-owned records and never touches
  pre-existing manual/config/SSO/API records, the engine row, or native
  Camunda grants.

**Done when:** the customer can preview, apply, verify, and reverse an import
without losing existing Camunda access or broadening EnterpriseGlue access.

### 5. Customer pilot and cutover

- Run inventory against the customer test engine first, with no write access.
- Resolve all `manual_required` and `blocked` items explicitly.
- Apply in the test environment; validate UI, APIs, process/decision lists,
  instances, jobs, history, and denied actions for agreed representative users.
- Decide direct Cockpit/API policy. If direct access remains, native grants stay
  as a separately governed guard; if not, restrict the direct path after the
  EnterpriseGlue acceptance run.
- Publish the following documentation as part of the feature, not afterwards:
  a user-facing migration and rollback runbook; an administrator guide for
  groups, roles, Runtime Resource Sets, acknowledgements, and direct-access
  posture; a developer/API reference for the import contracts and mapping
  catalogue; a security/operations guide for least-privileged Camunda access,
  encrypted preview retention, audit, monitoring, and incident rollback; and
  updated architecture, configuration-bundle, OpenAPI, and release-note
  references.

**Done when:** all agreed cases have evidence, unsupported grants are accepted
as explicit exceptions or remediated, and the customer signs off on the source
of truth and direct-access posture.

## Test and Acceptance Plan

The implementation must add focused, executable coverage in addition to the
existing engine-tenancy, runtime-resource, identity, database-adapter, and
cross-browser suites.

### Synthetic Camunda 7 Native-Grant Fixture Catalogue

Create a local, disposable Camunda 7 service with native authorization enabled
and seed it only through Camunda's supported authorization/identity APIs. The
fixture must never query or write Camunda system tables directly, and it must
not contain a customer export, customer identifier, production process name,
credential, or tenant identifier.

The generator creates deterministic synthetic identities, groups, runtime
tenants, process-definition keys, decision-definition keys, and authorization
records. It also produces a matching sanitized export fixture so both the live
API and customer-export import paths use the same semantic test matrix.

| Fixture family | Required synthetic cases |
| --- | --- |
| Supported group grants | Exact process-definition and decision-definition grants; read/start/operate/history-style permission candidates; multiple compatible grants for one group/key; separate groups with disjoint resources |
| Runtime tenancy | One resolved tenant per resource; no-tenant resource; two tenant partitions; unmapped tenant; conflicting tenant; dedicated engine with resource-aware access |
| Broad grants | `*`/all-resource group grant that stays blocked until an explicit broad-access acknowledgement is supplied |
| Non-convertible grants | Global grant, revoke, precedence-dependent combination, direct user grant, task/process-instance/deployment/batch/filter/application/administration resource, native tenant-administration grant, and unknown resource/permission |
| Identity mapping | Exact group map; missing group; ambiguous group; explicit user identity link; OIDC/SAML/LDAP-normalized memberships that land in the imported EnterpriseGlue group |
| Transport and source | Paginated native authorization inventory; duplicate/altered export rows; malformed export; unsupported adapter/version; unavailable native enumeration; expired/stale preview; read-only endpoint with a no-native-write assertion |

The fixture names should be intentionally obvious and non-customer-specific,
for example `eg-fixture-finance-operators`, `eg-fixture-invoice`, and
`eg-fixture-tenant-a`. The test harness destroys the Camunda container and its
volume after every run, checks that no generated credentials appear in retained
test artifacts, and uses ignored local secret references where a password is
unavoidable.

For every supported fixture, retain an expected outcome containing the native
grant classification, proposed EnterpriseGlue group/role/resource-set draft,
required acknowledgement, and allowed/denied Effective Access cases. The
fixture is therefore both synthetic data and an executable translation
specification.

| Area | Required coverage |
| --- | --- |
| Native input | Synthetic Camunda 7 pagination, duplicate rows, malformed records, unsupported engine/version, customer export validation, input hashing, and no-write guarantee |
| Translation | Every supported resource/permission mapping, exact key match, missing/inactive inventory, dedicated/resource-aware/shared topology, resolved/unmapped/conflicting tenant, broad `*`, global/revoke/user/manual cases |
| Identity | Group map, explicit user identity-link map, ambiguous/missing identity, and OIDC/SAML/LDAP-derived EnterpriseGlue group memberships |
| Authorization | Imported allowed and denied cases on definitions, decisions, instances, tasks, jobs, external tasks, history, mutations, batches, and migrations; native denial must not broaden EnterpriseGlue access |
| Safety | No default-tenant inference for shared engines, no secrets/PII in logs or ordinary responses, source ownership conflict, stale/altered preview, expiry, retry, rollback, and no native Camunda write |
| Interfaces | Schema/OpenAPI/API contract tests, config draft/preview/apply, Effective Access explanation, permission gates, and browser accessibility/UI tests |
| Integration | Disposable local Camunda 7 seeded from the synthetic native-grant fixture catalogue, plus an authenticated EnterpriseGlue scenario; selected customer test-environment evidence before production use |

Acceptance is not a blanket claim that every possible Camunda authorization is
converted. It is complete when **100% of the supported translation matrix is
covered**, every unsupported source record is visible and requires an explicit
outcome, and no import can create broader access than its approved preview.

### Current executable baseline

The checked-in `test/e2e/mock-camunda` fixture is the versioned synthetic
baseline for the currently supported `camunda7-v1-read-only` catalogue. Its
HTTP integration test proves paginated `GET /authorization` discovery and
covers both exact supported mappings, both broad acknowledgement cases, and
the visible manual/blocked dispositions for direct-user, global, revoke,
unsupported-resource, unsupported-permission, missing-principal,
missing-resource-id, and missing-runtime-resource rows. The backend
`CamundaNativeGrantDraftService` test additionally proves duplicate compatible
records collapse to one resource assignment. The local-safe PostgreSQL
integration test additionally applies that generated draft to an existing
engine, drains Runtime Resource Set materialization, verifies a
provider-synchronized member allow plus sibling/non-member denies through
Effective Access, and performs an authoritative import-owned rollback.
Shared-engine unresolved and ambiguous tenant cases remain covered by the
classifier/tenancy contract suite. The authenticated-browser and real Camunda
container scenarios above remain release qualification work; they must not be
represented as already executed by this synthetic baseline. The disposable
`test:camunda7-native-grant-container` contract now separately exercises the
real Camunda 7 REST service with synthetic API-seeded process-definition (`6`)
and decision-definition (`10`) `READ` grants. It proves the production
read-only inventory accepts Camunda's operational response fields only by
projecting them out before canonical hashing/classification, and never writes
while reading. It does not replace an authenticated EnterpriseGlue browser
acceptance journey or customer cutover evidence.

### Release-gate status and executable external handoff

The synthetic fixture, local PostgreSQL migration/rollback integration,
digest-pinned real-Camunda REST contract, focused backend/frontend tests, and
five-adapter physical schema matrix are local release evidence. The remaining
external gate is intentionally explicit rather than assumed: a browser-capable
local Docker environment must execute the authenticated preview/draft/apply,
Effective Access allow-and-deny, protected-route, accessibility, and
hash-bound rollback journey using only synthetic identities and grants. The
exact prerequisites, commands, retained artifacts, success criteria, and stop
conditions are maintained in the [developer handoff](../development/camunda7-native-grant-migration.md#authenticated-local-browser-evidence).
No runtime authority-mode change or compatibility removal is permitted before
that evidence exists.

## Rollback and Stop Conditions

Stop and do not apply when any of the following is true:

- the engine cannot be read through the approved secure connection;
- a shared resource lacks exactly one resolved tenant;
- a group/user cannot be matched safely;
- a permission/resource/revoke/global rule lacks an approved mapping;
- the generated draft has source-ownership conflicts or an altered/stale hash;
- a comparison case grants more EnterpriseGlue access than the approved native
baseline; or
- the customer has not decided how direct Cockpit/API access is governed.

Rollback uses the generated reverse config preview, explicit archive
acknowledgements, and re-runs Effective Access checks. It removes only records
created by the import. It does not delete or modify native Camunda grants,
historical customer access, engine credentials, engine registration, tenant
mappings, or unrelated EnterpriseGlue records.

## Follow-up Decisions

After the pilot, decide independently whether there is a demonstrated need for:

1. a recurring read-only native-grant drift report;
2. `mirrored_engine_backstop` for direct or customer-sidecar Camunda exposure; or
3. full `engine_native_authority`.

None of these is needed to complete the migration tool. Full native authority
must be a separate architecture decision and implementation program, with
identity propagation/import, conflict semantics, source ownership, operational
support, and end-to-end safety evidence designed before any setting accepts it.

## Related Documentation

- [JSON-Driven Authorization and Engine Registration Plan](11-json-driven-authz-and-engine-registration.md)
- [Centralized and Decentralized Engine Tenancy Implementation Plan](12-engine-tenancy-and-external-provisioning-plan.md)
- [Configure Authorization, Identity, and Engines](../how-to/configure-authorization-and-engines.md)
- [Migrate Camunda 7 Native Grants](../how-to/migrate-camunda7-native-grants.md)
- [Camunda 7 Native-Grant Migration API](../reference/camunda7-native-grant-migration-api.md)
- [Configure Dedicated and Shared Engine Tenancy](../how-to/configure-engine-tenancy.md)
