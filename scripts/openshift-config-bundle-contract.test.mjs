import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('staging and production project optional bundle and separate secret volumes', () => {
  const component = read('infra/kubernetes/openshift/kustomize/components/config-bundle/backend-config-bundle.yaml');
  const staging = read('infra/kubernetes/openshift/kustomize/overlays/staging/kustomization.yaml');
  const production = read('infra/kubernetes/openshift/kustomize/overlays/prod/kustomization.yaml');
  const development = read('infra/kubernetes/openshift/kustomize/overlays/dev/kustomization.yaml');

  assert.match(component, /configMap:\s+name: enterpriseglue-config-bundle\s+optional: true/);
  assert.match(component, /secret:\s+secretName: enterpriseglue-config-secrets\s+optional: true\s+[\s\S]*?defaultMode: 0444/);
  assert.match(component, /mountPath: \/etc\/enterpriseglue\/config\s+readOnly: true/);
  assert.match(component, /mountPath: \/var\/run\/secrets\/enterpriseglue\s+readOnly: true/);
  for (const [name, overlay] of [['staging', staging], ['production', production]]) {
    assert.match(overlay, /components:\s+- \.\.\/\.\.\/components\/config-bundle/, `${name} must enable the config-bundle component`);
  }
  assert.doesNotMatch(development, /components:/, 'development must remain bundle-optional');
});

test('backend readiness and rollout strategy retain the healthy ReplicaSet on bootstrap failure', () => {
  const deployment = read('infra/kubernetes/openshift/kustomize/base/app/backend-deployment.yaml');

  assert.match(deployment, /readinessProbe:\s+httpGet:\s+path: \/ready/);
  assert.match(deployment, /strategy:\s+type: RollingUpdate\s+rollingUpdate:\s+maxUnavailable: 0\s+maxSurge: 1/);
  assert.match(deployment, /livenessProbe:\s+httpGet:\s+path: \/health/);
});

test('the deploy script verifies bundle content before annotating a rollout and never deletes prior ReplicaSets', () => {
  const deploy = read('scripts/deploy-openshift.sh');
  const prepare = deploy.indexOf('prepare_config_bundle');
  const applyBundle = deploy.indexOf('apply_config_bundle');
  const rollout = deploy.indexOf('wait_for_rollout');

  assert.match(deploy, /EG_CONFIG_EXPECTED_SHA256 does not match EG_CONFIG_BUNDLE_FILE/);
  assert.match(deploy, /enterpriseglue\.ai\/config-bundle-sha256/);
  assert.ok(prepare >= 0 && applyBundle > prepare && rollout > applyBundle, 'content validation, hash rollout, and readiness wait must be ordered');
  assert.match(deploy, /rollout status deployment\/enterpriseglue-backend --timeout=300s/);
  assert.doesNotMatch(deploy, /\b(delete|rollout undo)\s+(replicaset|rs|deployment)\b/i);
});
