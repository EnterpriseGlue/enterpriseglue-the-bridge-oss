# EnterpriseGlue Plugin Runtime companion chart

This chart consumes
`helm.plugins.generated.values.yaml` from the signed plugin installer and
deploys only isolated plugin backend services.

It enforces digest images, non-root execution, read-only roots, dropped
capabilities, no service-account token, bounded resources/probes, retained
plugin PVCs, and deny-default network policy. The generated policy permits only
host-gateway traffic. A deployment-owned additional policy may implement a
reviewed named egress class; the plugin cannot put a DNS name or CIDR in its
manifest.

Each sidecar receives only the host gateway URL, an invocation public key, and
opaque secret references. The raw secret and fixed destination are mounted
into the EnterpriseGlue backend under its deployment-owned secret-broker
policy; they are never mounted into this companion chart's plugin pods.
Non-secret signed documents and public trust declared as `deployment_file`
come from `deploymentConfigFilesConfigMap` and are mounted read-only below the
fixed plugin configuration root. ConfigMap keys use
`<first-32-hex-of-SHA256(plugin-id)>--<reference>`; the chart filters the
volume to the current plugin's declared keys so one plugin cannot read another
plugin's documents. The bounded hash prefix keeps even maximum-length valid
plugin IDs and references inside Kubernetes ConfigMap key limits.

Plugin frontend assets require the EnterpriseGlue host's shared verified asset
volume and are not injected into this companion release. The installer renders
the host-side asset mount separately.

`platform: kubernetes` uses the chart's fixed non-root UID/GID (65532 by
default). Set `platform: openshift` when the namespace's
SecurityContextConstraints assigns the runtime identity. That profile retains
`runAsNonRoot`, seccomp, dropped capabilities, read-only roots, and the other
pod hardening controls while omitting `runAsUser`, `runAsGroup`, and `fsGroup`.

Before the first lifecycle apply, a customer cluster administrator installs
the sibling
`infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac` chart once. It
creates the dedicated namespace-scoped installer identity without Secret,
RBAC-mutation, pod exec/log, cross-namespace, or cluster-scoped authority.

```bash
helm upgrade --install enterpriseglue-plugins \
  ./infra/kubernetes/helm/enterpriseglue-plugin-runtime \
  -f ./generated/helm.plugins.generated.values.yaml
```

PVCs are annotated `helm.sh/resource-policy: keep`. Uninstall therefore never
silently deletes plugin data; the operator follows the explicit
retain/export/delete action selected in installer state.

The lifecycle adapter is the default PVC owner, so
`persistentVolumeClaims.create` defaults to `false`: stage creates and
identity-checks schema-versioned claims before Helm activates a workload. Set
it to `true` only when using the chart without the lifecycle adapter. Do not
switch ownership for an existing release.
