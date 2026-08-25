# Source-free Plugin Manager Compose kit

This directory is packaged with released, digest-pinned OSS backend, frontend, and Plugin Manager
subjects. Customers do not need a Git checkout or a local image build. Extract the release kit to
the absolute path recorded in its generated `.env.example`, then run:

```bash
sudo ./scripts/prepare-compose-runtime.sh /opt/enterpriseglue/plugin-deployment
```

Review the generated `.env`, replace every `change_me` value, and install the deployment-owned
workload token, signed catalog, catalog signature, trust policy, Cosign policy, and optional
registry credentials below `config/`. Start with the planner profile:

```bash
docker compose \
  --project-directory /opt/enterpriseglue/plugin-deployment \
  --env-file /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/.env \
  -f /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/docker-compose.selfhost.yml \
  -f /opt/enterpriseglue/plugin-deployment/kit/infra/docker/compose/docker-compose.plugin-manager.yml \
  --profile plugins-planner up -d
```

Managed mode requires an explicit review of Docker-socket authority. Select the matching
`manager-config.compose_managed.<architecture>.json.example`, copy it to
`config/manager-config.json`, and use `--profile plugins-managed`. Never start both profiles.

Before either mode, run `scripts/plugin-deployment-doctor.sh`. The doctor uses
the pinned manager image to verify every extracted kit component against
`deployment-kit.manifest.json` before rendering Compose. Add
`--route-origin https://enterpriseglue.customer.example` after the static frontend/CDN route is
deployed; the doctor fails if `/_enterpriseglue/plugins` reaches the SPA fallback instead of the
backend.

The production kit uses an absolute host bind for manager state. Its host source and container
target are deliberately identical so the Docker daemon can resolve generated plugin state and
asset mounts. Back up that directory together with the application database. A named
`plugin_manager_state` volume remains available only for compatibility with the planner profiles
from OSS v0.15.0-v0.15.3.
