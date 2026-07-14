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
  ['infra/docker/compose/docker-compose.selfhost.yml', ['docker-compose.config-bundle.yml']],
  ['docs/how-to/deploy-docker.md', ['EG_CONFIG_BUNDLE_HOST_PATH', 'docker-compose.config-bundle.yml']],
  ['docs/how-to/deploy-localhost.md', ['EG_CONFIG_BOOTSTRAP_MODE', 'EG_CONFIG_BUNDLE_PATH']],
];
for (const [file, entries] of deploymentContracts) {
  const content = readFileSync(file, 'utf8');
  for (const entry of entries) {
    if (!content.includes(entry)) missing.push(`${file}: ${entry}`);
  }
}

if (missing.length > 0) {
  console.error('[config-deployment-contract] Missing bootstrap contract entries:');
  for (const entry of missing) console.error(`- ${entry}`);
  process.exit(1);
}
console.log(`[config-deployment-contract] OK (${variables.length} variables across ${requiredFiles.length} files; ${deploymentContracts.length} deployment paths)`);
