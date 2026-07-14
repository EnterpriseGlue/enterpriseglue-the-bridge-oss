import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const variables = [
  'EG_CONFIG_BUNDLE_PATH',
  'EG_CONFIG_BOOTSTRAP_MODE',
  'EG_CONFIG_EXPECTED_SHA256',
  'EG_CONFIG_EXPECTED_TENANT_SCOPE',
  'EG_CONFIG_FAIL_CLOSED',
  'EG_CONFIG_REQUIRE_SECRET_PREFLIGHT',
  'EG_CONFIG_MAX_BYTES',
  'EG_CONFIG_SECRET_PROVIDER',
  'EG_CONFIG_SECRET_FILE_ROOT',
];
const requiredFiles = [
  'packages/shared/src/config/index.ts',
  'backend/.env.example',
  'docs/reference/configuration.md',
  'docs/reference/configuration-matrix.md',
  ...readdirSync('infra/docker/env/examples').filter((name) => name.endsWith('.env.example')).map((name) => join('infra/docker/env/examples', name)),
];

const missing = [];
for (const file of requiredFiles) {
  const content = readFileSync(file, 'utf8');
  for (const variable of variables) {
    const aliases = file.endsWith('/openshift.env.example') && variable === 'EG_CONFIG_BUNDLE_PATH'
      ? ['EG_CONFIG_BUNDLE_PATH', 'EG_CONFIG_BUNDLE_FILE']
      : [variable];
    if (!aliases.some((entry) => content.includes(entry))) missing.push(`${file}: ${variable}`);
  }
}

const deploymentContracts = [
  ['dev.sh', ['EG_CONFIG_BUNDLE_HOST_PATH', 'docker-compose.config-bundle.yml']],
  ['scripts/deploy-compose.sh', ['source', 'images-postgres', 'images-oracle', 'EG_CONFIG_BUNDLE_HOST_PATH', 'docker-compose.config-bundle.yml']],
  ['scripts/deploy-localhost.sh', ['EG_CONFIG_BOOTSTRAP_MODE', 'EG_CONFIG_BUNDLE_PATH']],
  ['scripts/deploy-openshift.sh', ['prepare_config_bundle', 'validate_manifests', 'OPENSHIFT_SECRET_SOURCE', 'EG_CONFIG_BUNDLE_PATH', 'enterpriseglue-config-secrets']],
  ['infra/docker/compose/docker-compose.selfhost.yml', ['docker-compose.config-bundle.yml']],
  ['infra/kubernetes/openshift/kustomize/components/config-bundle/backend-config-bundle.yaml', ['mountPath: /etc/enterpriseglue/config', 'secretName: enterpriseglue-config-secrets', 'defaultMode: 0444']],
  ['infra/kubernetes/openshift/examples/external-secrets.example.yaml', ['apiVersion: external-secrets.io/v1', 'name: enterpriseglue-secrets', 'name: enterpriseglue-config-secrets']],
  ['docs/how-to/deploy-docker.md', ['EG_CONFIG_BUNDLE_HOST_PATH', 'docker-compose.config-bundle.yml']],
  ['docs/how-to/deploy-localhost.md', ['EG_CONFIG_BOOTSTRAP_MODE', 'EG_CONFIG_BUNDLE_PATH']],
  ['docs/how-to/deploy-openshift.md', ['OPENSHIFT_SECRET_SOURCE', 'external-secrets.example.yaml', 'EG_CONFIG_SECRETS_DIR']],
];
for (const [file, entries] of deploymentContracts) {
  const content = readFileSync(file, 'utf8');
  for (const entry of entries) {
    if (!content.includes(entry)) missing.push(`${file}: ${entry}`);
  }
}

const openshiftDeployScript = readFileSync('scripts/deploy-openshift.sh', 'utf8');
const openshiftStartupOrder = [
  'prepare_config_bundle',
  'validate_manifests',
  'validate_secret_source',
  'apply_base_manifests',
  'apply_runtime_secret',
  'apply_config_reference_secret',
  'apply_runtime_config',
  'apply_config_bundle',
  'annotate_secret_versions',
];
const openshiftMain = openshiftDeployScript.slice(openshiftDeployScript.indexOf('main()'));
let previousIndex = -1;
for (const step of openshiftStartupOrder) {
  const stepIndex = openshiftMain.indexOf(`  ${step}`);
  if (stepIndex < 0 || stepIndex <= previousIndex) missing.push(`scripts/deploy-openshift.sh: ordered ${step}`);
  previousIndex = stepIndex;
}
for (const runtimeBinding of [
  'EG_CONFIG_BUNDLE_PATH: "$CONFIG_BUNDLE_CONTAINER_PATH"',
  'EG_CONFIG_EXPECTED_SHA256: "$CONFIG_BUNDLE_HASH"',
]) {
  if (!openshiftDeployScript.includes(runtimeBinding)) missing.push(`scripts/deploy-openshift.sh: ${runtimeBinding}`);
}

const productionDockerfile = readFileSync('backend/Dockerfile.prod', 'utf8');
const dockerfileInstructions = productionDockerfile
  .replace(/\\\r?\n\s*/g, ' ')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const requiredImageContracts = [
  'mkdir -p /etc/enterpriseglue/config /var/run/secrets/enterpriseglue',
  'chown -R 65532:65532 /etc/enterpriseglue /var/run/secrets/enterpriseglue',
];
for (const contract of requiredImageContracts) {
  if (!productionDockerfile.replace(/\\\r?\n\s*/g, ' ').includes(contract)) {
    missing.push(`backend/Dockerfile.prod: ${contract}`);
  }
}
const runtimeUsers = dockerfileInstructions
  .filter((line) => /^USER\s+/i.test(line))
  .map((line) => line.replace(/^USER\s+/i, '').trim());
if (runtimeUsers.at(-1) !== '65532') {
  missing.push('backend/Dockerfile.prod: final runtime USER 65532');
}
for (const instruction of dockerfileInstructions.filter((line) => /^(COPY|ADD)\s+/i.test(line))) {
  if (/config[-_]?bundle|enterpriseglue[-_]?config|bundle\.(json|zip)|\/etc\/enterpriseglue\/config/i.test(instruction)) {
    missing.push(`backend/Dockerfile.prod: customer bundle must not be baked (${instruction})`);
  }
}
const dockerignore = readFileSync('.dockerignore', 'utf8').split(/\r?\n/).map((line) => line.trim());
for (const ignoredPath of ['/.local/', '/config/']) {
  if (!dockerignore.includes(ignoredPath)) missing.push(`.dockerignore: ${ignoredPath}`);
}

if (missing.length > 0) {
  console.error('[config-deployment-contract] Missing bootstrap contract entries:');
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}
console.log(`[config-deployment-contract] OK (${variables.length} variables across ${requiredFiles.length} files; ${deploymentContracts.length} deployment paths; non-root backend image)`);
