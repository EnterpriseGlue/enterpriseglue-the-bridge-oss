# OpenShift Deployment

Summary: Deploy EnterpriseGlue to OpenShift using the repo's Kustomize overlays and deployment script.

Audience: Developers and architects.

The backend deployment projects optional configuration and secret volumes. The deployment script creates a bundle ConfigMap from `EG_CONFIG_BUNDLE_FILE`, verifies and annotates its SHA-256 to trigger rollout, and waits for the bootstrap readiness gate. The complete contract is documented in [Deploy Authorization Configuration](./deploy-authorization-config.md).

## Layout
- Kustomize base: `infra/kubernetes/openshift/kustomize/base/`
- Kustomize overlays:
  - `infra/kubernetes/openshift/kustomize/overlays/dev`
  - `infra/kubernetes/openshift/kustomize/overlays/staging`
  - `infra/kubernetes/openshift/kustomize/overlays/prod`
- Example manifests:
  - `infra/kubernetes/openshift/examples/image-pull-secret.example.yaml`
  - `infra/kubernetes/openshift/examples/runtime-secret.example.yaml`
  - `infra/kubernetes/openshift/examples/external-secrets.example.yaml`
- Env template for deployment script:
  - `infra/docker/env/examples/openshift.env.example`

## Prerequisites
- `oc` CLI authenticated to the target cluster/namespace.
- OpenShift namespace already created.
- Backend and frontend images available in registry.

## Configure env vars
Copy and edit the OpenShift env template:

```bash
cp infra/docker/env/examples/openshift.env.example .local/docker/env/openshift.env
```

Always-required variables include:
- `OPENSHIFT_NAMESPACE`
- `OPENSHIFT_ROUTE_HOST`
- `BACKEND_IMAGE`
- `FRONTEND_IMAGE`

The default `OPENSHIFT_SECRET_SOURCE=environment` additionally requires:

- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ENCRYPTION_KEY`

Environment mode creates the runtime Secret from these exported values. Set `OPENSHIFT_SECRET_SOURCE=external` to require pre-existing `enterpriseglue-secrets` and, for file-backed bundle references, `enterpriseglue-config-secrets`. External mode validates those target Secrets before applying application manifests and never overwrites them.

### External Secrets Operator

If the cluster uses External Secrets Operator, copy `infra/kubernetes/openshift/examples/external-secrets.example.yaml`, replace the store name and remote keys, and apply it before EnterpriseGlue:

```bash
oc -n "$OPENSHIFT_NAMESPACE" apply -f infra/kubernetes/openshift/examples/external-secrets.example.yaml
oc -n "$OPENSHIFT_NAMESPACE" wait --for=condition=Ready externalsecret/enterpriseglue-runtime --timeout=120s
oc -n "$OPENSHIFT_NAMESPACE" wait --for=condition=Ready externalsecret/enterpriseglue-config-references --timeout=120s
```

The example uses the stable `external-secrets.io/v1` API and a `ClusterSecretStore` named `enterpriseglue-secret-store`. A namespaced `SecretStore` is also supported by changing `kind`. The controller writes the fixed target Secret names consumed by the deployment.

## Database configuration

### PostgreSQL — connection string (recommended for external/managed DBs)

Set `POSTGRES_URL` in your env file. Individual host vars are not required when the URL is set:

```env
POSTGRES_URL=postgresql://user:password@mydb.example.com:5432/enterpriseglue?schema=main&sslmode=require
```

For two-host production setups, point `POSTGRES_URL` at a single load-balancer or pgBouncer endpoint that fronts both hosts.

### PostgreSQL — individual variables (in-cluster PostgreSQL service)

```env
POSTGRES_HOST=postgresql
POSTGRES_USER=enterpriseglue
POSTGRES_PASSWORD=change_me
POSTGRES_DATABASE=enterpriseglue
POSTGRES_SCHEMA=main
POSTGRES_SSL=false
```

### Oracle — multi-host connection string

Use `ORACLE_CONNECTION_STRING` for any Oracle setup with two or more hosts. `ORACLE_HOST`/`ORACLE_PORT`/`ORACLE_SERVICE_NAME` are not required when this is set:

```env
# Easy Connect Plus (two hosts, automatic failover)
ORACLE_CONNECTION_STRING=host1.example.com:1521,host2.example.com:1521/MYSERVICE
ORACLE_USER=enterpriseglue
ORACLE_PASSWORD=change_me
ORACLE_SCHEMA=ENTERPRISEGLUE
DATABASE_TYPE=oracle
```

See `infra/docker/env/examples/openshift.env.example` and `infra/kubernetes/openshift/examples/runtime-secret.example.yaml` for full examples.

### Optional Configuration Bundle

Set the following in the deployment environment to mount and bootstrap one JSON payload:

```env
EG_CONFIG_BUNDLE_FILE=./config/enterpriseglue.json
EG_CONFIG_BOOTSTRAP_MODE=validate
EG_CONFIG_EXPECTED_TENANT_SCOPE=platform
EG_CONFIG_FAIL_CLOSED=true
```

The script calculates the bundle SHA-256, creates `enterpriseglue-config-bundle`, and rolls the backend. Use `apply` only after reviewing the API/CLI preview; the projected ConfigMap contains bundle JSON only, never secret values.

For environment-managed file references, place one secret per file in a private directory and configure:

```env
EG_CONFIG_SECRET_PROVIDER=file
EG_CONFIG_SECRETS_DIR=./.local/enterpriseglue-config-secrets
```

The script creates the separate `enterpriseglue-config-secrets` Secret from that directory. In external mode, omit `EG_CONFIG_SECRETS_DIR`; the external controller must reconcile the target Secret instead. Projected files use read-only mode `0444` so OpenShift-assigned non-root UIDs can read them without requiring a fixed SCC group. The pod contains only the backend container, and access remains limited by the pod and namespace security boundaries.

## Deploy
Use the script entrypoint (default overlay is `prod`):

```bash
set -a && source .local/docker/env/openshift.env && set +a
pnpm run deploy:openshift
```

Use a different overlay when needed:

```bash
set -a && source .local/docker/env/openshift.env && set +a
OPENSHIFT_OVERLAY=staging pnpm run deploy:openshift
```

## Notes
- The script applies base manifests via `oc apply -k` using the selected overlay.
- Before mutation, the script computes and verifies the bundle hash, renders the selected overlay with `oc kustomize`, runs client-side manifest validation, and verifies that configured bundle/secret projections exist.
- The computed bundle path and SHA-256 are written to the runtime ConfigMap before the hash annotation triggers the backend rollout.
- Runtime and config-reference Secrets remain separate; `OPENSHIFT_SECRET_SOURCE=external` prevents the script from replacing controller-managed Secrets.
- Secret resource versions are copied to pod-template annotations. Rerun the deployment after an external runtime-secret rotation to roll pods even when image and bundle references are unchanged.
- Optional health check bypass:

```bash
SKIP_EXTERNAL_HEALTHCHECK=true pnpm run deploy:openshift
```

Use that bypass only when the route is intentionally inaccessible from the
deployment host; it does not bypass the pod readiness probe. During an `apply`
bootstrap, `/ready` remains `503` until the configuration transaction,
materialization, and bounded identity replay complete. Diagnose a failed rollout
with the sanitized `/ready` response, backend log, metrics, and apply-run receipt;
none contains resolved secret values.

The backend Deployment uses `maxUnavailable: 0` and a five-minute progress
deadline. On either rollout failure, the deploy script exits without automatically
rolling back or deleting a ReplicaSet, leaving the previously ready ReplicaSet
available. Inspect the failure, restore the prior reviewed image or configuration
input, and rerun the deployment rather than changing live ReplicaSets manually.

To roll back configuration, restore the previous reviewed bundle in
`EG_CONFIG_BUNDLE_FILE` and rerun the deployment. The script computes a new
annotation from that content and starts a normal rollout. Keep the previous
ReplicaSet until the new pod is ready, and never delete or overwrite an
External-Secrets-managed target as part of rollback.
