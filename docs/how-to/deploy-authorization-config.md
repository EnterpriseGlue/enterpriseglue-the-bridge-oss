# Deploy Authorization Configuration

Summary: Target deployment and CI/CD contract for EnterpriseGlue authorization, identity, and engine configuration bundles.

Audience: Platform engineers, security engineers, and CI/CD maintainers.

Status: **Partially implemented runbook.** API-driven configuration-bundle preview, hash-bound apply, export, apply history, and the `pnpm authz:config` CLI are available. File-based bootstrap validation/apply, optional dev/source-production/published-image/self-host/OpenShift mounts, host-based bootstrap input, Engine Set/runtime-resource materialization receipts, and durable stored-identity replay continuation are available behind disabled-by-default settings. Existing deployments continue to start without a bundle.

For implementation completion and verification status across authorization, identity, and engine registration, use [the architecture tracker](../architecture/11-json-driven-authz-and-engine-registration.md); this runbook intentionally lists only operationally supported deployment paths.

Related guides:

- [Configure Authorization, Identity, And Engines](./configure-authorization-and-engines.md)
- [Docker Compose Deployment](./deploy-docker.md)
- [OpenShift Deployment](./deploy-openshift.md)
- [Deployment Runbook](./deployment-runbook.md)
- [JSON-Driven Authorization and Engine Registration](../architecture/11-json-driven-authz-and-engine-registration.md)

## Recommended Deployment Contract

Support two apply paths that use the same validation and apply services:

1. **Bootstrap file (implemented):** optional JSON payload path read by the backend after migrations and catalog seeding. The optional Docker/OpenShift read-only mounts are available.
2. **CI/CD API apply (implemented):** recommended for later updates because preview, approval, apply, export, and run status are explicit deployment stages.

Do not make automatic startup apply the default. Existing standalone installations must still start without a bundle.

## Target Environment Variables

| Variable | Values | Purpose |
| --- | --- | --- |
| `EG_CONFIG_BUNDLE_PATH` | Absolute JSON or ZIP file path | Read-only bootstrap bundle location; ZIP archives contain `bundle.json` and declared imported JSON files |
| `EG_CONFIG_BOOTSTRAP_MODE` | `disabled`, `validate`, `apply` | Startup behavior; default `disabled` |
| `EG_CONFIG_EXPECTED_SHA256` | SHA-256 or empty | Reject an unexpected mounted bundle |
| `EG_CONFIG_EXPECTED_TENANT_SCOPE` | `platform` or tenant id | Required target scope for bootstrap apply |
| `EG_CONFIG_FAIL_CLOSED` | `true`, `false` | Keep readiness false when configured bootstrap validation/apply fails; production default `true` |
| `EG_CONFIG_REQUIRE_SECRET_PREFLIGHT` | `true`, `false` | Require all bundle secret references to be available before configured startup validation or apply; default `false` |
| `EG_CONFIG_SECRET_PROVIDER` | `env`, `file`, provider extension id | Resolve secret references without placing secret values in bundles |
| `EG_CONFIG_SECRET_FILE_ROOT` | Absolute directory | Allowed root for file-based secret references |
| `EG_CONFIG_MAX_BYTES` | Positive integer | Bundle upload/read size limit |

Names are target contracts and must be added to shared configuration validation, backend `.env.example`, Docker/OpenShift templates, configuration reference, and configuration matrix together.

Implemented now: shared configuration validation, backend `.env.example`, file-size/hash validation, `validate`/`apply` startup modes, production fail-closed default, optional Docker/OpenShift mounts, and sanitized health/readiness bootstrap status. Each successful apply receipt reports completed Engine Set/runtime-resource materialization counts; stored identity replay continuation is durable and can be awaited by CI.

## Startup Ordering

The backend startup sequence must be:

```text
load process environment
-> connect database
-> run schema migrations
-> seed immutable permission/action/system-role catalog
-> validate optional mounted bundle
-> optionally preflight opaque secret-reference availability
-> preview and apply only when bootstrap mode is apply
-> materialize affected Engine Sets and runtime resources
-> record reconciliation counts in the apply receipt
-> defer provider identity reconciliation to its dedicated sync workflow
-> publish config status
-> become ready
```

`/health` is the liveness/diagnostic endpoint. `/ready` is the readiness endpoint and returns `503` when bootstrap configuration has failed. Production fail-closed mode stops startup before the server listens; non-fail-closed mode preserves `/health` diagnostics while keeping `/ready` false.

Runtime authorization never reads the mounted JSON files directly.

## Docker Compose Changes

Add an optional Compose override instead of forcing config mounts into every deployment:

```text
infra/docker/compose/docker-compose.config-bundle.yml
```

Implemented Compose override mount:

```yaml
services:
  backend:
    volumes:
      - ${EG_CONFIG_BUNDLE_HOST_PATH}:/etc/enterpriseglue/config/bundle.json:ro
      - ${EG_CONFIG_SECRETS_HOST_PATH:-./.local/enterpriseglue-config-secrets}:/var/run/secrets/enterpriseglue:ro
    environment:
      EG_CONFIG_BUNDLE_PATH: /etc/enterpriseglue/config/bundle.json
```

Enable it only for an explicit bootstrap deployment:

```bash
EG_CONFIG_BUNDLE_HOST_PATH=./config/enterpriseglue.json \
EG_BACKEND_ENV_FILE=./.local/docker/env/production.env \
docker compose --project-directory . \
  --env-file ./.local/docker/env/production.env \
  -f infra/docker/compose/docker-compose.prod.yml \
  -f infra/docker/compose/docker-compose.config-bundle.yml up -d
```

Required changes:

- [x] ✅ Update `dev.sh`, production/image startup scripts to include the override only when a host bundle path is configured. `EG_CONFIG_BUNDLE_HOST_PATH` selects the Compose overlay; the default local start remains unchanged.
- [x] ✅ Add disabled-by-default bootstrap variables to every Docker/OpenShift environment example and the configuration reference/matrix.
- [x] ✅ Ensure backend production images can read `/etc/enterpriseglue/config` as a non-root user. The production image creates and grants the projection directory to the Chainguard runtime user.
- [x] ✅ Keep secret files in a separate read-only mount with stricter permissions; never put them in the config bundle volume. The optional Compose overlay mounts the bundle file and secret directory independently as read-only paths.
- [x] ✅ Add health/readiness output for bundle status, hash, and local materialization state without exposing configuration contents. Historical last-run details and provider identity reconciliation state remain pending.
- [ ] ⬜ Test paths containing spaces, missing mounts, read-only mounts, invalid JSON, wrong hash, unresolved secret refs, and restart idempotency.

## OpenShift And Kubernetes Changes

Use separate resources:

- ConfigMap or read-only projected volume for non-secret bundle files.
- Secret or external secret provider for secret values referenced by the bundle.
- Deployment environment variables for bootstrap policy and expected hash.

Required changes:

- [x] ✅ Add an optional config-bundle ConfigMap/projected-volume component to the Kustomize base.
- [x] ✅ Add dev/staging/prod patches that can enable or omit the bundle mount independently. The reusable `config-bundle` component is omitted by development and included by staging/production overlays.
- [x] ✅ Extend `runtime-secret.example.yaml` only with secret values and secret-provider configuration, never bundle JSON containing secrets.
- [x] ✅ Extend `configmap.yaml` with non-secret bootstrap settings.
- [x] ✅ Update the OpenShift deployment script to create/apply the bundle ConfigMap before backend rollout when enabled.
- [x] ✅ Include bundle hash annotations in the backend pod template so an intended bundle change triggers rollout.
- [x] ✅ Apply runtime Secret/ConfigMap values before the bundle hash triggers rollout, and reject bundle bootstrap against the mountless `dev` overlay.
- [ ] ⬜ Complete readiness gating for migrations, catalog seed, config apply, and all required reconciliation. `/ready` fails after bootstrap configuration failure; bootstrap diagnostics now report `pending` when durable stored-identity replay continuation remains, but readiness intentionally stays available while that bounded background work completes.
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
# Set a stable key for one CI run. Reusing it with different bundle input is rejected.
export ENTERPRISEGLUE_CONFIG_IDEMPOTENCY_KEY="release-2026-07-13-001"
# Use `platform` for the OSS default tenant; use the authenticated tenant ID in multi-tenant deployments.
export ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE="platform"
# Optional: none skips stored snapshots, preview reports bounded membership
# changes without replaying snapshots, and apply performs the bounded replay.
export ENTERPRISEGLUE_CONFIG_IDENTITY_RECONCILIATION_MODE="apply"

# Optional: continue truncated stored identity snapshot replay pages in the
# backend after the bundle request has completed. Disabled by default.
export CONFIG_BUNDLE_IDENTITY_REPLAY_INTERVAL_MS="60000"
export CONFIG_BUNDLE_IDENTITY_REPLAY_RUN_ON_START="false"
export CONFIG_BUNDLE_IDENTITY_REPLAY_MAX_TASKS="10"
export CONFIG_BUNDLE_IDENTITY_REPLAY_PAGE_LIMIT="500"

# Validates the local JSON and performs the server-side preview. Exit code 2
# means the bundle was rejected by preview validation.
pnpm authz:config validate ./enterpriseglue-config.json

# Produces the canonical preview, including its hash. This has no side effects.
pnpm authz:config preview ./enterpriseglue-config.json

# Repeats preview and applies using the canonical hash returned by that exact
# preview. Do not modify the file between preview approval and this command.
pnpm authz:config apply ./enterpriseglue-config.json

# Wait for any durable stored-identity replay continuation created by an apply.
# Default timeout is five minutes; both values are milliseconds.
ENTERPRISEGLUE_CONFIG_RECONCILIATION_TIMEOUT_MS=300000 \
ENTERPRISEGLUE_CONFIG_RECONCILIATION_POLL_MS=1000 \
pnpm authz:config wait <apply-run-id>

# Exports the server-side state owned by a previously applied bundle.
pnpm authz:config export acme-platform-authz
```

The CLI calls the same backend APIs used by the UI. It never connects directly to the database. `apply` sends the server-produced canonical hash as `expectedPreviewHash`, so stale or altered bundles fail closed. Set `ENTERPRISEGLUE_CONFIG_IDEMPOTENCY_KEY` for CI retries: a completed matching apply returns its original receipt, while reusing the key with different bundle input is rejected. The CLI returns `64` for invalid invocation, `2` for preview validation failure, and `1` for API, I/O, or transport failures.

Before promoting a bundle workflow or backend image, run the focused contract
suite from the repository root:

```bash
pnpm test:authz-refactor
```

It runs the named identity-contract, identity-route-integration, and
configuration-bundle suites. It does not replace the separate browser
end-to-end environment that will use containerized identity providers.

The repository also includes a manually dispatched GitHub Actions workflow at `.github/workflows/config-bundle.yml`. Before using it, create a protected GitHub Environment for each target and configure:

- `ENTERPRISEGLUE_API_URL` as an Environment variable;
- `ENTERPRISEGLUE_CONFIG_TOKEN` as an Environment secret for an API client with `config:bundle:manage` and an RBAC assignment granting `platform:authz:roles:manage`;
- `ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE` as an Environment variable (`platform` for OSS default tenant, otherwise the target tenant ID);
- `identity_reconciliation_mode` is selected on workflow dispatch: `apply` is backward-compatible default behavior, `preview` records bounded stored-snapshot impact without replaying snapshots, and `none` skips that replay;
- required reviewers for environments that permit `apply`.

When a bounded `apply` replay is truncated, EnterpriseGlue records one durable continuation task per affected provider. Enable `CONFIG_BUNDLE_IDENTITY_REPLAY_INTERVAL_MS` on the backend to continue those pages. The worker leases each task, cancels stale queued work when a newer bundle supersedes the same provider, and retries transient failures with capped exponential backoff. Inspect continuation state from the apply-run details in Platform Settings or `GET /api/authz/config-bundles/runs/{id}/identity-replay-tasks`.

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

- [x] ✅ Require an explicit expected tenant scope for CLI applies and protected CI runs; the API rejects a mismatch with the authenticated tenant. GitHub Environment protection binds the target environment and its credentials.
- [x] ✅ Add persisted tenant-scoped idempotency keys. A matching completed apply replays its receipt; a key reused for other bundle input or an unfinished/failed run is rejected.
- [x] ✅ Require the server-generated canonical preview hash on apply; the apply service rejects an altered or stale bundle.
- [x] ✅ Allow apply callers to select `none`, `preview`, or bounded `apply` replay for affected stored identity snapshots. Replay starts after the config database transaction commits; normal source-scoped cleanup for changed or disabled config mappings remains part of that transaction.
- [x] ✅ Persist provider/cursor continuation tasks for truncated config-apply replay pages and process them through an explicitly enabled, leased backend worker with retry backoff and apply-run diagnostics.
- [x] ✅ Print sanitized machine-readable preview, apply, and export responses suitable for CI artifacts.
- [x] ✅ Return distinct exit codes for validation (`2`), authorization (`3`), conflict (`4`), reconciliation (`5`), and transport/server failures (`6`). Usage errors return `64`.
- [x] ✅ Sanitize all configuration CLI stdout/stderr before GitHub Actions or other CI systems can archive it. Access tokens, provider secrets and references, engine credentials, certificates, LDAP bind values, and customer peer tokens are redacted defensively even if an upstream response is malformed.

## Database Migrations And Compatibility

Migrations must complete before config validation/apply. The migration set includes canonical role assignments, external identities, provider-neutral mappings, config ownership/run history, runtime resources, engine connection mode, deployment lineage, and related indexes.

Because this is a greenfield refactor, there is no production legacy-data backfill requirement. The deployment still needs startup ordering and schema-version checks so an old backend cannot apply a new bundle schema and a new backend cannot run against an old database schema.

## Secrets

Bundles contain references only. Supported initial reference forms should be narrowly defined, for example:

```text
env://OIDC_CLIENT_SECRET
file:///var/run/secrets/enterpriseglue/oidc-client-secret
```

`env://NAME` references remain environment-backed. File-backed references use `file://` only when `EG_CONFIG_SECRET_PROVIDER=file` and `EG_CONFIG_SECRET_FILE_ROOT` are configured; paths outside that root are rejected. External secret-manager adapters can be extensions. All resolution goes through the shared `SecretResolver` and returns redacted diagnostics.

Set `EG_CONFIG_REQUIRE_SECRET_PREFLIGHT=true` when a configured bootstrap must
prove that every referenced `env://` or `file://` secret is available before it
is considered valid. This is opt-in so existing standalone deployments and
validation-only bundle workflows keep their current behavior. For `apply`, the
service binds the write to the same status-only availability hash so a secret
that disappears after preflight fails the apply rather than creating a partial
authorization configuration.

Customer-sidecar downstream peer tokens are never EnterpriseGlue secret references because EnterpriseGlue must not receive them.

### Docker Compose Secret Reference Example

The following is the intended optional override once bootstrap mounting is enabled. It is not a current Compose feature: current deployments must use the API/CLI apply path and their existing secret injection.

```yaml
services:
  backend:
    environment:
      EG_CONFIG_SECRET_PROVIDER: file
      EG_CONFIG_SECRET_FILE_ROOT: /var/run/secrets/enterpriseglue
    volumes:
      - ${EG_CONFIG_SECRETS_HOST_PATH:?set-a-private-secret-directory}:/var/run/secrets/enterpriseglue:ro
```

The bundle would refer to a file without including its value:

```json
{
  "key": "identity.oidc.production",
  "type": "oidc",
  "oidc": {
    "clientSecretRef": "file:///var/run/secrets/enterpriseglue/oidc-client-secret"
  }
}
```

Keep the host secret directory outside the source repository and outside the non-secret config-bundle mount. Run the backend as a non-root user with read-only access to only the required files.

### OpenShift Secret Reference Example

Keep secret bytes in an OpenShift `Secret`, then mount individual keys at the same read-only path used by the bundle reference. The ConfigMap/projected bundle mount remains planned; this example documents the required separation.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: enterpriseglue-config-secrets
type: Opaque
stringData:
  oidc-client-secret: replace-through-external-secret-management
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: backend
          env:
            - name: EG_CONFIG_SECRET_PROVIDER
              value: file
            - name: EG_CONFIG_SECRET_FILE_ROOT
              value: /var/run/secrets/enterpriseglue
          volumeMounts:
            - name: config-secrets
              mountPath: /var/run/secrets/enterpriseglue
              readOnly: true
      volumes:
        - name: config-secrets
          secret:
            secretName: enterpriseglue-config-secrets
            defaultMode: 0400
```

Use External Secrets, Sealed Secrets, or the organization's managed secret operator to create the `Secret`; do not commit the literal `stringData` value. CI bundle exports, previews, apply receipts, logs, audits, and OpenAPI responses must contain only the reference URI.

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
