# Deployment Runbook (Docker-First)

Summary: Operational steps for running EnterpriseGlue with Docker Compose.

Audience: Developers and architects.

## Preflight
- Docker and Docker Compose installed.
- Ports available (defaults): `8787` (backend), `5173` (frontend), `5432` (postgres).
- If these are occupied, change `.local/docker/env/docker.env` values (`BACKEND_HOST_PORT`, `FRONTEND_HOST_PORT`, `POSTGRES_HOST_PORT`).
- `.local/docker/env/docker.env` exists (auto-created by `pnpm run dev` or copied from `infra/docker/env/examples/docker.postgres.env.example`).

## Start
```bash
pnpm run dev
```

## Verify
- Backend health: `http://localhost:8787/health` (when `EXPOSE_BACKEND=true`)
- If `EXPOSE_BACKEND=false`, use proxied health endpoint on frontend origin (for example `http://localhost:5173/health`).
- Frontend: `http://localhost:5173`
- Login using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.local/docker/env/docker.env`.

## Production Compose Notes
- `pnpm run prod` serves frontend via Nginx on `FRONTEND_HOST_PORT` (default `8080`).
- Backend is internal-only in production; API calls are proxied through the frontend origin.
- Keep `FRONTEND_URL` aligned with `FRONTEND_HOST_PORT` in `.local/docker/env/production.env`.

## Production from Images (Runbook)
1. Copy one template:
   - `cp infra/docker/env/examples/images.postgres.env.example .local/docker/env/images.postgres.env`
   - or `cp infra/docker/env/examples/images.oracle.env.example .local/docker/env/images.oracle.env`
2. Set `BACKEND_IMAGE`, `FRONTEND_IMAGE`, and `IMAGE_TAG`.
3. Start from images:
   - `pnpm run prod:images:postgres`
   - or `pnpm run prod:images:oracle`

### Verify (image mode)
- Frontend: `http://localhost:8080`
- Proxied backend health: `http://localhost:8080/health`

### Rollback (image mode)
1. Edit active `.local/docker/env/images.*.env` file.
2. Set `IMAGE_TAG` to previous known-good version.
3. Re-run same `pnpm run prod:images:*` command.

### Stop (image mode)
- `pnpm run prod:images:postgres:down`
- `pnpm run prod:images:oracle:down`

## Logs
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f backend
```
```bash
docker compose --project-directory . -f infra/docker/compose/docker-compose.yml logs -f frontend
```

## Optional plugin diagnostic collection

Keep automatic collection disabled for initial deployment. To pilot locally filtered diagnostic
handoff, mount a reviewed collector policy, Ed25519 private key, bearer credential, and approved
read-only log source into the backend, then set:

```text
ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_COLLECTOR_POLICY_FILE=/run/enterpriseglue/collector/policy.json
ENTERPRISEGLUE_PLUGIN_DIAGNOSTIC_AUTO_COLLECTION_ENABLED=true
```

The policy—not a plugin, browser, model, or incident—owns the log path, engine/profile allowlist,
byte/line limits, key/credential paths, HTTPS endpoint, and bundle lifetime. Validate first with
the private Support repository's `pnpm verify:plugin-diagnostic-handoff` synthetic smoke. If any
step fails, set the enable flag back to `false`; never add a raw-upload fallback or log the policy,
source content, signing key, credential, or upstream response.

Choose exactly one parser kind per approved source: `file_tail`,
`docker_json_file_tail`, or `kubernetes_cri_file_tail`. Docker JSON-file and Kubernetes/OpenShift
CRI adapters consume only a fixed read-only file mount, validate the record envelope, discard
unneeded runtime metadata, and pass normalized text through the same local redaction/post-scan.
Do not mount a Docker socket, CRI socket, kubeconfig, service-account token, broad host log tree,
or Kubernetes API permission for this collector. A deployment update—not a browser request—is
required when the approved rotated-file mount changes.
The shipped
[disabled generic example](../../packages/backend-host/examples/diagnostic-collector/policy.example.json)
is parsed by the production policy schema in CI. Copy it into deployment-owned configuration;
never edit and activate the repository example in place.

After startup, use the entitled plugin's read-only status/connection check. The host returns only
collection permission, `ready`/`disabled`/`degraded`/`unavailable`, a fixed reason code,
`none`/`single`/`multiple` approved-source class, and a check time. A degraded signing key,
credential, endpoint shape, or source-file check is actionable locally, but the UI must never
show the affected path, endpoint, identifier, or credential. The health check reads no log
content and performs no Support handoff.

Deployment administrators can read aggregate diagnostic telemetry from
`GET /api/plugin-platform/v1/metrics/diagnostics`. Use only the closed plugin/status/reason/
byte-band/source-count counters for alerting. The endpoint is protected by the same deployment
administrator middleware as plugin lifecycle state and audit. It never returns tenant, engine,
case, incident, path, endpoint, content, credential, correlation, or exact byte values. Its
in-process counters reset on backend rollout; long-term retention belongs in the customer's
authenticated metrics backend.

Deployment administrators can also read aggregate event lifecycle telemetry from
`GET /api/plugin-platform/v1/metrics/events`. Alert only on the closed plugin/event-type enqueue,
delivery, attempt-class, and circuit series. Sustained `retry_wait`, `dead_letter`,
`circuit_open`, or `plugin_backlog_full` outcomes are operator signals. The response never
contains tenant/deployment/event/delivery/operation identity or event payload. The counters are
per backend process and reset on rollout, so calculate rates only after the authenticated
monitoring system has aggregated replicas. Use the existing payload-free dead-letter control API
and audited exact replay for recovery; metrics are not a replay or configuration interface.

## Install a commercial plugin without customer CI

Commercial plugin source and publisher CI remain private. A customer receives a read-only OCI
entitlement or a vendor-prepared signed package; the existing OSS host image is not replaced.

The locally implemented connected flow is one deployment-side command:

```text
./scripts/eg-plugin install-oci \
  --subject registry.example/plugin@sha256:<digest> \
  --trust ./publisher-trust.json \
  --cosign-policy ./publisher-workflow-policy.json \
  --host-version <exact-oss-version> \
  --output ./.enterpriseglue/plugins
```

The wrapper uses `EG_PLUGIN_REGISTRY_CONFIG` when set, otherwise the standard
`${DOCKER_CONFIG:-$HOME/.docker}/config.json`. The credential must grant read-only access.
`EG_PLUGIN_REGISTRY_CA` supplies an optional private registry CA, and
`EG_PLUGIN_OCI_NETWORK` selects a reviewed Docker network. The command requires an immutable
digest, verifies Cosign workflow identity plus Ed25519 package/catalog signatures, validates the
catalog and all indexed evidence referrers, removes temporary material, and installs disabled.

Then:

1. Review the rendered desired state and required permission grants.
2. Run the appropriate deployment worker (`apply-compose` or `apply-kubernetes`).
3. Keep the plugin disabled until readiness and entitlement checks pass, then enable it
   explicitly.

No customer compiler, private source checkout, npm token, or CI pipeline is required. Keep
registry credentials, trust policy, Docker socket, kubeconfig, and raw package evidence out of
the browser, OSS application containers, and plugin runtime containers.

The source command, locked-down wrapper, pinned-tool installer image, adversarial unit tests, and
disposable OCI 1.1 acceptance are implemented locally. The published installer digest, first
entitled registry execution, proxy/custom-CA customer acceptance, and production trust-policy
handoff remain release gates. Do not replace these gates with a browser upload, customer CI,
mutable tag, or registry credential mounted into EnterpriseGlue.

## Verify release-image browser invariants

This is an EnterpriseGlue maintainer/publisher check, not a customer installation step:

```text
pnpm run guard:release-dockerfile-pins
pnpm run guard:frontend-self-contained
```

The first command denies mutable external bases and mutable declared BuildKit syntax images in
release-producing Dockerfiles. The second requires locally packaged IBM Plex fonts, removal of
Carbon's external font faces, no Google font links, and production
`font-src 'self' data:`. Never add a public font host to production CSP to make a test pass.

The paid-plugin publisher additionally runs its production Mission Control image acceptance by a
registry-derived OSS host digest with no runtime build/pull. A passing local source-server test is
not a substitute. Customers consume the reviewed signed artifacts; they do not run this build or
need a CI pipeline.

## Plugin event-stream proxying

The supplied frontend Nginx configuration disables buffering only for the fixed same-origin
plugin-operation routes and uses a 130-second read timeout, which is longer than the manifest's
maximum 120-second operation timeout. The backend still owns authentication, manifest/schema
validation, admission, circuit, byte/event, and disconnect enforcement. If a customer ingress is
placed in front of Nginx, configure it to preserve `text/event-stream`, flush incremental chunks,
and honor `X-Accel-Buffering: no`. Never expose a sidecar directly or weaken the gateway when a
stream falls back to bounded JSON polling.

Gateway admission is shared through the EnterpriseGlue database in production. Treat database
unavailability as a deliberate fail-closed plugin outage, not a reason to bypass admission.
Concurrency leases expire after the bounded operation lifetime, so a crashed backend replica
recovers without manual counter repair. Event backlog ceilings are also deployment-wide. If a
subscriber reaches its limit, pause or repair that plugin and drain/replay its durable queue;
do not increase the limit until storage, recovery time, and customer impact have been reviewed.

## Plugin lifecycle status

The generated plugin Compose overlay mounts both `plugin-installer-state.json` and
`plugin-lifecycle-observation.json` read-only into the backend. Platform administrators can view
the safe deployment progress in **Plugin management** or through
`GET /api/plugin-platform/v1/deployment-execution`.

Treat this as installer progress only. The response deliberately says
`workloadReconciliation: not_checked`; verify the deployed workload separately before declaring a
change operational. A `stale` or `invalid` observation exposes no execution details. Inspect the
deployment worker and desired-state revision locally—never mount
`plugin-lifecycle-execution.json`, the Docker socket, kubeconfig, or raw plan into the web
application.

## Plugin frontend activation quarantine

If one native plugin disappears and the browser console reports a closed
`entry_url_invalid`, `module_invalid`, `activation_failed`, or `activation_quarantined` state:

1. Record only plugin ID, exact version, installer/bootstrap revision, closed failure code, host
   image digest, browser family/version, and occurrence time. Do not copy a plugin exception,
   stack, page content, route/resource identifier, or browser storage.
2. Verify the signed catalog, staged entry digest, host/shared-runtime compatibility, and public
   frontend-entry policy. Confirm ordinary OSS and another compatible plugin remain usable.
3. Do not repeatedly clear local storage to bypass containment. Three failures in five minutes
   quarantine only the exact source in that browser for fifteen minutes; an accepted upgrade or
   rollback revision gets a new attempt.
4. Withdraw or roll back a defective signed artifact through `eg-plugin`; do not patch staged
   JavaScript at the customer.
5. Use **Plugin management** runtime disable or the deployment lifecycle only when independent
   evidence warrants broader action. One browser's local state must never trigger deployment or
   backend disable.
6. After recovery, verify activation, Carbon theme/focus/locale behavior, unrelated-plugin
   operation, and the expected safe console state.

## Stop
```bash
pnpm run down
```

## Reset (clean volumes)
```bash
pnpm run down -- -v
```

## Production-Style Local Deployment
For a host-based build and preview flow:
```bash
bash ./scripts/deploy-localhost.sh
```
Requires `backend/.env` and a frontend env file.
