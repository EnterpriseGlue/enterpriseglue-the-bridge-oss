# OpenShift Deployment

Summary: Deploy EnterpriseGlue to OpenShift using the repo's Kustomize overlays and deployment script.

Audience: Developers and architects.

## Layout
- Kustomize base: `infra/kubernetes/openshift/kustomize/base/`
- Kustomize overlays:
  - `infra/kubernetes/openshift/kustomize/overlays/dev`
  - `infra/kubernetes/openshift/kustomize/overlays/staging`
  - `infra/kubernetes/openshift/kustomize/overlays/prod`
- Example manifests:
  - `infra/kubernetes/openshift/examples/image-pull-secret.example.yaml`
  - `infra/kubernetes/openshift/examples/runtime-secret.example.yaml`
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

Required variables include:
- `OPENSHIFT_NAMESPACE`
- `OPENSHIFT_ROUTE_HOST`
- `BACKEND_IMAGE`
- `FRONTEND_IMAGE`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ENCRYPTION_KEY`

## Deploy
Use the script entrypoint (default overlay is `prod`):

```bash
set -a && source .local/docker/env/openshift.env && set +a
npm run deploy:openshift
```

Use a different overlay when needed:

```bash
set -a && source .local/docker/env/openshift.env && set +a
OPENSHIFT_OVERLAY=staging npm run deploy:openshift
```

## Notes
- The script applies base manifests via `oc apply -k` using the selected overlay.
- Runtime secret and config are applied after base manifests so env-driven values win.
- Optional health check bypass:

```bash
SKIP_EXTERNAL_HEALTHCHECK=true npm run deploy:openshift
```
