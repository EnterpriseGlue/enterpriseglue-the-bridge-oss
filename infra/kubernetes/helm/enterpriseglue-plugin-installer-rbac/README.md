# EnterpriseGlue plugin installer RBAC

This one-time bootstrap chart creates a dedicated service account and
namespace-scoped deployment Role for `apply-kubernetes`. It is installed by a
customer cluster administrator; it is not customer CI and it gives no
cluster-scoped authority.

For source-checkout development and CI:

```bash
helm upgrade --install enterpriseglue-plugin-installer-rbac \
  ./infra/kubernetes/helm/enterpriseglue-plugin-installer-rbac \
  --namespace enterpriseglue-plugins \
  --create-namespace
```

For a supported customer deployment, use the exact installer and chart digest references plus
archive SHA-256 from one accepted
`enterpriseglue-plugin-toolchain-release/v1` receipt. Verify the workflow-identity signatures,
pull the RBAC chart by digest with the approved OCI tool, verify the archive hash, and install the
local verified `.tgz`. Do not install by a mutable chart tag:

```bash
export EG_PLUGIN_INSTALLER_IMAGE='ghcr.io/enterpriseglue/plugin-installer@sha256:<digest>'
export RBAC_CHART='ghcr.io/enterpriseglue/charts/enterpriseglue-plugin-installer-rbac@sha256:<digest>'

cosign verify \
  --certificate-identity-regexp '^https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/plugin-toolchain-release.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$RBAC_CHART"
RBAC_LAYER_DIGEST="$(
  oras manifest fetch "$RBAC_CHART" |
    jq -er '
      [.layers[]
        | select(.mediaType == "application/vnd.cncf.helm.chart.content.v1.tar+gzip")
        | .digest]
      | if length == 1 then .[0] else error("expected exactly one Helm chart layer") end
    '
)"
mkdir -p ./.enterpriseglue/toolchain/rbac
oras blob fetch \
  --output ./.enterpriseglue/toolchain/rbac/enterpriseglue-plugin-installer-rbac-<version>.tgz \
  "${RBAC_CHART%@*}@$RBAC_LAYER_DIGEST"

helm upgrade --install enterpriseglue-plugin-installer-rbac \
  ./.enterpriseglue/toolchain/rbac/enterpriseglue-plugin-installer-rbac-<version>.tgz \
  --namespace enterpriseglue-plugins \
  --create-namespace
```

Use exact certificate identity in automated policy; the regex form above is shown only because
the digest placeholders make the example portable. Independently compare the pulled archive
SHA-256 to the accepted receipt before invoking Helm.

For an air-gapped deployment, import the complete signed generic-toolchain bundle before running
Helm. Provision the Sigstore trusted root through an independently approved trust channel; never
trust a replacement root solely because it accompanied the removable media:

```bash
cosign verify-blob \
  --bundle ./toolchain-airgap/toolchain-airgap.sigstore.json \
  --certificate-identity \
    https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/plugin-toolchain-release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --trusted-root /etc/enterpriseglue/trust/sigstore-trusted-root.json \
  ./toolchain-airgap/toolchain-airgap.json

# Independently compare the utility SHA-256 to .utility.sha256 in the
# now-verified manifest before executing it.
node ./toolchain-airgap/toolchain-airgap.mjs import \
  --bundle ./toolchain-airgap \
  --target-prefix registry.customer.example/enterpriseglue \
  --certificate-identity \
    https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/.github/workflows/plugin-toolchain-release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --trusted-root /etc/enterpriseglue/trust/sigstore-trusted-root.json \
  --receipt ./toolchain-airgap-import-receipt.json
```

Accept only the three exact target digest references in that receipt. The importer verifies the
signed bundle, archive inventory, subject signatures, destination digests, and chart payload
hashes without contacting the publisher registry or running customer CI.

The Role can reconcile only plugin ConfigMaps, PVCs, Services,
ServiceAccounts, Deployments and their scale subresource, ReplicaSets for
rollout observation, Jobs, Pods for status observation, and NetworkPolicies in
that namespace. It cannot read or change Secrets or RBAC, execute in or read
logs from Pods, mutate other namespaces, or access cluster-scoped resources.
Helm uses the ConfigMap release driver.

Create a short-lived or routinely rotated, self-contained kubeconfig for this
service account according to customer identity policy. Pass that single
regular, non-symlinked file as `EG_PLUGIN_KUBECONFIG` to the digest-pinned
customer worker. Do not distribute a cluster-admin kubeconfig.

For rotation, obtain the replacement before the active credential expires,
write it to a new regular, non-symlinked mode-`0600` file, and use that file for
the next idempotent lifecycle command. Remove the old local file after the
replacement succeeds, then revoke or let the old credential expire according
to customer identity-provider policy. Removing a local kubeconfig is not
server-side credential revocation.

The local Kubernetes 1.36.1 lifecycle acceptance uses two distinct 15-minute
restricted credentials: initial install/enable uses the first, while upgrade,
rollback, failure recovery, disable, and uninstall use the replacement.

OpenShift uses the same Role. A cluster administrator separately binds only
the runtime service accounts—not the installer worker—to the approved
restricted SecurityContextConstraints policy. The runtime chart's
`platform: openshift` profile lets that policy assign pod UID/GID.
