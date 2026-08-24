# EnterpriseGlue Plugin Manager chart

This chart runs the public, generic Plugin Manager as an isolated customer-local workload. The
manager has no browser route or Service. It pulls authorized installation intents from the OSS
backend, verifies immutable plugin releases, and uses the namespace-scoped installer identity to
apply only the fixed lifecycle operations.

Install the `enterpriseglue-plugin-installer-rbac` chart first. Create one Secret containing the
closed `EnterpriseGluePluginManagerConfig` document plus the workload token, trust policy, public
trust material, and optional registry configuration referenced by that document. The browser and
ordinary backend never receive registry or Kubernetes credentials.

```bash
helm upgrade --install enterpriseglue-plugin-manager \
  ./infra/kubernetes/helm/enterpriseglue-plugin-manager \
  --namespace enterpriseglue-plugins \
  --set-string image='ghcr.io/enterpriseglue/plugin-manager@sha256:<digest>'
```

The PVC is retained when the chart is removed so exact execution journals and rollback receipts
are not silently deleted. Supply customer-owned egress NetworkPolicies for the OSS backend,
approved registry, DNS, and Kubernetes API endpoints. The chart denies all inbound pod traffic;
health probes run locally through the kubelet.
