# Deploy Authorization Configuration

Summary: Target deployment and CI/CD contract for EnterpriseGlue authorization, identity, and engine configuration bundles.

Audience: Platform engineers, security engineers, and CI/CD maintainers.

Status: **Partially implemented runbook.** API-driven configuration-bundle preview, hash-bound apply, export, apply history, and the `pnpm authz:config` CLI are available. Mounted bootstrap bundles, startup reconciliation/readiness integration, and Docker/OpenShift bundle mounts remain planned. Existing deployments continue to start without a bundle.

Related guides:

- [Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md)
- [Docker Compose Deployment](./deploy-docker.md)
- [OpenShift Deployment](./deploy-openshift.md)
- [Deployment Runbook](./deployment-runbook.md)
- [JSON-Driven Authorization and Engine Registration](../architecture/11-json-driven-authz-and-engine-registration.md)

## Recommended Deployment Contract

Support two apply paths that use the same validation and apply services:

1. **Bootstrap mount (planned):** optional, read-only bundle mounted into the backend for deterministic first deployment and restart reconciliation.
2. **CI/CD API apply (implemented):** recommended for later updates because preview, approval, apply, export, and run status are explicit deployment stages.

Do not make automatic startup apply the default. Existing standalone installations must still start without a bundle.

## Target Environment Variables

| Variable | Values | Purpose |
| --- | --- | --- |
| `EG_CONFIG_BUNDLE_PATH` | Absolute file or folder path | Read-only bootstrap bundle location |
| `EG_CONFIG_BOOTSTRAP_MODE` | `disabled`, `validate`, `apply` | Startup behavior; default `disabled` |
| `EG_CONFIG_EXPECTED_SHA256` | SHA-256 or empty | Reject an unexpected mounted bundle |
| `EG_CONFIG_FAIL_CLOSED` | `true`, `false` | Keep readiness false when configured bootstrap validation/apply fails; production default `true` |
| `EG_CONFIG_DRIFT_MODE` | `report`, `fail`, `reconcile` | Behavior for config-owned drift |
| `EG_CONFIG_SECRET_PROVIDER` | `env`, `file`, provider extension id | Resolve secret references without placing secret values in bundles |
| `EG_CONFIG_SECRET_FILE_ROOT` | Absolute directory | Allowed root for file-based secret references |
| `EG_CONFIG_MAX_BYTES` | Positive integer | Bundle upload/read size limit |

Names are target contracts and must be added to shared configuration validation, backend `.env.example`, Docker/OpenShift templates, configuration reference, and configuration matrix together.

## Startup Ordering

The backend startup sequence must be:

```text
load process environment
-> connect database
-> run schema migrations
-> seed immutable permission/action/system-role catalog
-> validate optional mounted bundle
-> preview and apply only when bootstrap mode is apply
-> run required identity/Engine Set/runtime-resource/target reconciliation
-> publish config status
-> become ready
```

Liveness can remain healthy while configuration apply is in progress. Readiness must remain false when production fail-closed mode is enabled and validation, apply, secret resolution, or required reconciliation fails.

Runtime authorization never reads the mounted JSON files directly.

## Docker Compose Changes

Add an optional Compose override instead of forcing config mounts into every deployment:

```text
infra/docker/compose/docker-compose.config-bundle.yml
```

Target mount:

```yaml
services:
  backend:
    volumes:
      - ${EG_CONFIG_BUNDLE_HOST_PATH:-./enterpriseglue-config}:/etc/enterpriseglue/config:ro
    environment:
      EG_CONFIG_BUNDLE_PATH: /etc/enterpriseglue/config
```

Required changes:

- [ ] ⬜ Update `dev.sh`, production/image startup scripts, and Compose documentation to include the override only when a host bundle path is configured.
- [ ] ⬜ Add target variables to every Docker env example without enabling bootstrap apply by default.
- [ ] ⬜ Ensure backend production images can read `/etc/enterpriseglue/config` as a non-root user.
- [ ] ⬜ Keep secret files in a separate read-only mount with stricter permissions; never put them in the config bundle volume.
- [ ] ⬜ Add health/readiness output for bundle status, hash, last run, and reconciliation state without exposing configuration contents.
- [ ] ⬜ Test paths containing spaces, missing mounts, read-only mounts, invalid JSON, wrong hash, unresolved secret refs, and restart idempotency.

## OpenShift And Kubernetes Changes

Use separate resources:

- ConfigMap or read-only projected volume for non-secret bundle files.
- Secret or external secret provider for secret values referenced by the bundle.
- Deployment environment variables for bootstrap policy and expected hash.

Required changes:

- [ ] ⬜ Add an optional config-bundle ConfigMap/projected-volume component to the Kustomize base.
- [ ] ⬜ Add dev/staging/prod patches that can enable or omit the bundle mount independently.
- [ ] ⬜ Extend `runtime-secret.example.yaml` only with secret values and secret-provider configuration, never bundle JSON containing secrets.
- [ ] ⬜ Extend `configmap.yaml` with non-secret bootstrap settings.
- [ ] ⬜ Update the OpenShift deployment script to create/apply the bundle ConfigMap before backend rollout when enabled.
- [ ] ⬜ Include bundle hash annotations in the backend pod template so an intended bundle change triggers rollout.
- [ ] ⬜ Add readiness probes that wait for migration, catalog seed, config apply, and required reconciliation.
- [ ] ⬜ Define failed-rollout behavior that leaves the previous ReplicaSet available when the new bundle fails closed.

## CI/CD Apply Flow

The implemented API-driven pipeline stages are:

```text
schema validate
-> static secret/reference policy checks
-> environment preview
-> human or policy approval for high-risk changes
-> apply exact preview correlation id + bundle hash
-> wait for reconciliation
-> smoke-test representative personas and engine connections
-> archive receipt and sanitized diff
```

Machine access uses a dedicated API client with the `config:bundle:manage` scope and a scoped role assignment that grants `platform:authz:roles:manage`. Both checks are required. It must not use a human Platform Admin token; issue and rotate the reveal-once machine token through the deployment secret store.

### Create A Least-Privilege Configuration Client

1. In **Platform Settings > Access Control > API clients**, create an API client with only **Configuration bundles** selected.
2. In **Role Library**, create a platform-scoped custom role containing only `platform:authz:roles:manage` unless a broader reviewed configuration role already exists.
3. In **Assignments**, assign that role to the API client at platform scope.
4. Store the reveal-once token as the target GitHub Environment's `ENTERPRISEGLUE_CONFIG_TOKEN` secret. Record its prefix, owner, target environment, and rotation date outside the bundle.
5. Revoke or rotate the token immediately after a suspected leak. A client without the scope, without the RBAC role assignment, or after revocation cannot preview, apply, export, or read bundle history.

Use the repository CLI:

```bash
# All commands require a backend base URL without a trailing slash and a
# non-human bearer token. JSON output is suitable for CI artifacts.
export ENTERPRISEGLUE_API_URL="https://enterpriseglue.example"
export ENTERPRISEGLUE_API_TOKEN="$EG_CONFIG_TOKEN"

# Validates the local JSON and performs the server-side preview. Exit code 2
# means the bundle was rejected by preview validation.
pnpm authz:config validate ./enterpriseglue-config.json

# Produces the canonical preview, including its hash. This has no side effects.
pnpm authz:config preview ./enterpriseglue-config.json

# Repeats preview and applies using the canonical hash returned by that exact
# preview. Do not modify the file between preview approval and this command.
pnpm authz:config apply ./enterpriseglue-config.json

# Exports the server-side state owned by a previously applied bundle.
pnpm authz:config export acme-platform-authz
```

The CLI calls the same backend APIs used by the UI. It never connects directly to the database. `apply` sends the server-produced canonical hash as `expectedPreviewHash`, so stale or altered bundles fail closed. The CLI returns `64` for invalid invocation, `2` for preview validation failure, and `1` for API, I/O, or transport failures.

The repository also includes a manually dispatched GitHub Actions workflow at `.github/workflows/config-bundle.yml`. Before using it, create a protected GitHub Environment for each target and configure:

- `ENTERPRISEGLUE_API_URL` as an Environment variable;
- `ENTERPRISEGLUE_CONFIG_TOKEN` as an Environment secret for an API client with `config:bundle:manage` and an RBAC assignment granting `platform:authz:roles:manage`;
- required reviewers for environments that permit `apply`.

Dispatch `preview` first against an immutable reviewed commit SHA, inspect the uploaded JSON receipt, then dispatch `apply` for that same SHA. The workflow requires the literal `APPLY` confirmation and serializes runs per environment. It is intentionally not triggered by pull requests and never uses a repository-wide human credential.

The corresponding authenticated routes are:

```text
POST /api/authz/config-bundles/preview
POST /api/authz/config-bundles/diff
POST /api/authz/config-bundles/apply
GET  /api/authz/config-bundles/runs
GET  /api/authz/config-bundles/export?bundleKey=<key>
```

Required behavior:

- [ ] ⬜ Add an explicit expected environment/tenant id and caller-supplied idempotency key to the CLI/API contract.
- [x] ✅ Require the server-generated canonical preview hash on apply; the apply service rejects an altered or stale bundle.
- [x] ✅ Print sanitized machine-readable preview, apply, and export responses suitable for CI artifacts.
- [ ] ⬜ Return distinct exit codes for validation, authorization, conflict, reconciliation, and transport failures.
- [ ] ⬜ Never print access tokens, provider secrets, engine credentials, certificates, LDAP bind passwords, or customer peer tokens.

## Database Migrations And Compatibility

Migrations must complete before config validation/apply. The migration set includes canonical role assignments, external identities, provider-neutral mappings, config ownership/run history, runtime resources, engine connection mode, deployment lineage, and related indexes.

Because this is a greenfield refactor, there is no production legacy-data backfill requirement. The deployment still needs startup ordering and schema-version checks so an old backend cannot apply a new bundle schema and a new backend cannot run against an old database schema.

## Secrets

Bundles contain references only. Supported initial reference forms should be narrowly defined, for example:

```text
env://OIDC_CLIENT_SECRET
file:///var/run/secrets/enterpriseglue/oidc-client-secret
```

External secret-manager adapters can be extensions. All resolution goes through the shared `SecretResolver` and returns redacted diagnostics.

Customer-sidecar downstream peer tokens are never EnterpriseGlue secret references because EnterpriseGlue must not receive them.

## Readiness And Observability

Expose sanitized status fields:

- configured bundle id and hash;
- bootstrap mode;
- last validation/apply run id and status;
- drift status;
- reconciliation status and counts;
- unresolved-reference count;
- last successful apply time.

Metrics and logs must distinguish schema validation, authorization denial, ownership conflict, secret-resolution failure, reconciliation failure, and engine/sidecar transport failure.

## Rollback

Rollback uses the previous known-good bundle through preview/apply. Do not restore only JSON files and assume runtime state changes automatically.

Deployment rollback sequence:

1. Select the previous application image and compatible bundle version.
2. Preview the previous bundle against current state.
3. Review source-owned removals and role/assignment impact.
4. Apply with a new idempotency key.
5. Wait for reconciliation and readiness.
6. Verify break-glass admin, representative users, engines, targets, Mission Control, and deployment eligibility.

Normal rollback never deletes manual, API, identity-provider, or system-owned records because they are absent from the config bundle.

## Documentation And Artifact Update Matrix

| Artifact | Required update |
| --- | --- |
| `backend/.env.example` | Add target bundle, drift, fail-closed, and secret-provider settings |
| Docker env examples | Add disabled-by-default settings and optional host mount path |
| Compose files and scripts | Add optional read-only bundle/secret mounts and startup selection |
| Production Dockerfile | Ensure non-root readable config path and no bundle baked into image |
| OpenShift ConfigMap/Kustomize | Add optional bundle projection and hash-triggered rollout |
| OpenShift runtime Secret | Add secret-provider values only |
| OpenShift deploy script | Validate/apply config resources and wait for readiness |
| `docs/reference/configuration*.md` | Document every environment setting and default |
| `docs/how-to/auth-sso.md` | Replace provider-specific-only flow with provider-neutral OIDC/SAML/LDAP setup and group mappings |
| Docker/OpenShift deployment guides | Document mount, first apply, update, readiness, and rollback |
| Deployment runbook | Add preview/apply/reconcile/rollback and lockout recovery |
| Security hardening | Add secret refs, endpoint SSRF/TLS policy, config API scopes, and audit redaction |
| Troubleshooting | Add validation, drift, reconciliation, provider, central-engine filtering, and sidecar transport diagnostics |
| OpenAPI | Document config, identity, engine connection, status, and reconciliation routes |

## End-To-End Test Matrix

- [ ] ⬜ Docker dev, production build, and published-image deployment with no bundle.
- [ ] ⬜ Docker deployment with a valid mounted bundle and restart idempotency.
- [ ] ⬜ Docker fail-closed behavior for invalid bundle, hash mismatch, and unresolved secret.
- [ ] ⬜ OpenShift deployment with ConfigMap bundle and Secret refs.
- [ ] ⬜ OpenShift failed rollout leaves prior healthy ReplicaSet available.
- [ ] ⬜ CI preview/apply/reapply/rollback with idempotency and sanitized receipts.
- [ ] ⬜ Standalone, OIDC, SAML, LDAP, multiple-provider, and standalone-to-SSO scenarios.
- [ ] ⬜ Distributed engine, central engine, externally registered engine, and customer-sidecar engine scenarios.
- [ ] ⬜ Manual records survive config apply and rollback unless ownership transfer was explicitly previewed.
- [ ] ⬜ Config-owned drift follows `report`, `fail`, and `reconcile` behavior.
- [ ] ⬜ No secret or identity token appears in exported bundles, API responses, logs, audits, or CI artifacts.
