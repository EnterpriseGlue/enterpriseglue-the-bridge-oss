#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digestReference = /^[^\s@]+@sha256:[a-f0-9]{64}$/;

function usage() {
  return [
    'Usage: node scripts/build-plugin-compose-deployment-kit.mjs',
    '  --output <directory>',
    '  --host-version <version>',
    '  --backend-image <repository@sha256:digest>',
    '  --frontend-image <repository@sha256:digest>',
    '  --manager-image <repository@sha256:digest>',
    '  [--deployment-root /opt/enterpriseglue/plugin-deployment]',
    '  [--state-directory /opt/enterpriseglue/plugin-manager/state]',
  ].join('\n');
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(usage());
    }
    values[key.slice(2)] = value;
  }
  return values;
}

function required(values, name) {
  const value = values[name]?.trim();
  if (!value) throw new Error(`${name} is required\n${usage()}`);
  return value;
}

function absoluteDeploymentPath(value, field) {
  if (!value.startsWith('/') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${field} must be an absolute path`);
  }
  return value.replace(/\/$/, '');
}

function immutableReference(value, field) {
  if (!digestReference.test(value)) {
    throw new Error(`${field} must be an immutable repository@sha256 reference`);
  }
  return value;
}

async function ensureEmptyOutput(output) {
  if (output === resolve('/') || output === repository) {
    throw new Error('refusing unsafe deployment-kit output path');
  }
  const details = await stat(output).catch(() => undefined);
  if (details && !details.isDirectory()) {
    throw new Error('deployment-kit output exists and is not a directory');
  }
  if (details && (await readdir(output)).length > 0) {
    throw new Error('deployment-kit output must be empty or absent');
  }
  await mkdir(output, { recursive: true, mode: 0o755 });
}

async function copy(source, target, mode = 0o644) {
  const from = resolve(repository, source);
  const to = resolve(target);
  await mkdir(dirname(to), { recursive: true, mode: 0o755 });
  await copyFile(from, to);
  await chmod(to, mode);
}

function managerConfig(template, input) {
  const config = structuredClone(template);
  config.capability.deploymentModes = [input.mode];
  config.capability.architectures = ['amd64', 'arm64'];
  config.capability.state =
    input.mode === 'compose_planner' ? 'planner_only' : 'ready';
  config.host.version = input.hostVersion;
  config.host.artifact = input.backendImage;
  config.deployment.mode = input.mode;
  config.deployment.architecture = input.architecture;
  config.storage.releaseRoot = `${input.stateDirectory}/releases`;
  config.storage.executionRoot = `${input.stateDirectory}/executions`;
  config.storage.installerOutput = `${input.stateDirectory}/installer`;
  config.offlineDelivery.intakeRoot = `${input.stateDirectory}/releases`;
  config.adapter.projectDirectory = input.stateDirectory;
  config.adapter.composeFiles = [
    `${input.stateDirectory}/deployment/infra/docker/compose/docker-compose.selfhost.yml`,
    `${input.stateDirectory}/installer/docker-compose.plugins.generated.yaml`,
  ];
  config.adapter.utilityImage = input.managerImage;
  return config;
}

async function regularFiles(root, directory = root) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    const details = await stat(path);
    if (details.isDirectory()) files.push(...(await regularFiles(root, path)));
    else if (details.isFile()) files.push(relative(root, path).split(sep).join('/'));
  }
  return files;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function buildPluginComposeDeploymentKit(input) {
  const output = resolve(input.output);
  await ensureEmptyOutput(output);

  const copies = [
    ['infra/docker/compose/docker-compose.selfhost.yml', 'kit/infra/docker/compose/docker-compose.selfhost.yml'],
    ['infra/docker/compose/docker-compose.plugin-manager.yml', 'kit/infra/docker/compose/docker-compose.plugin-manager.yml'],
    ['infra/docker/compose/docker-compose.config-bundle.yml', 'kit/infra/docker/compose/docker-compose.config-bundle.yml'],
    ['infra/docker/env/examples/selfhost.env.example', 'kit/infra/docker/compose/.env.example'],
    ['infra/docker/plugin-manager/README.md', 'README.md'],
    ['infra/docker/plugin-manager/prepare-compose-runtime.sh', 'scripts/prepare-compose-runtime.sh', 0o755],
    ['infra/docker/plugin-manager/plugin-deployment-doctor.sh', 'scripts/plugin-deployment-doctor.sh', 0o755],
    ['infra/docker/plugin-manager/verify-deployment-kit.mjs', 'scripts/verify-deployment-kit.mjs', 0o755],
    ['infra/cdn/plugin-routing/routing-contract.json', 'kit/infra/cdn/plugin-routing/routing-contract.json'],
    ['infra/cdn/plugin-routing/nginx-static-frontend.conf.template', 'kit/infra/cdn/plugin-routing/nginx-static-frontend.conf.template'],
    ['infra/cdn/plugin-routing/cloudfront-behaviors.example.json', 'kit/infra/cdn/plugin-routing/cloudfront-behaviors.example.json'],
    ['infra/cdn/plugin-routing/azure-front-door-routes.example.json', 'kit/infra/cdn/plugin-routing/azure-front-door-routes.example.json'],
    ['infra/cdn/plugin-routing/cloudflare-worker-router.example.js', 'kit/infra/cdn/plugin-routing/cloudflare-worker-router.example.js'],
    ['infra/cdn/plugin-routing/check-plugin-route.sh', 'kit/infra/cdn/plugin-routing/check-plugin-route.sh', 0o755],
  ];
  for (const [source, target, mode] of copies) {
    await copy(source, resolve(output, target), mode);
  }

  const environmentPath = resolve(
    output,
    'kit/infra/docker/compose/.env.example',
  );
  const baseEnvironment = await readFile(environmentPath, 'utf8');
  await writeFile(
    environmentPath,
    `${baseEnvironment.trimEnd()}\n\n# Immutable v${input.hostVersion} deployment subjects\nEG_BACKEND_IMAGE_REF=${input.backendImage}\nEG_FRONTEND_IMAGE_REF=${input.frontendImage}\nEG_PLUGIN_MANAGER_IMAGE=${input.managerImage}\nEG_PLUGIN_DEPLOYMENT_DIRECTORY=${input.deploymentRoot}/kit\nEG_PLUGIN_MANAGER_CONFIG_DIRECTORY=${input.deploymentRoot}/config\nEG_PLUGIN_MANAGER_STATE_SOURCE=${input.stateDirectory}\nEG_PLUGIN_MANAGER_STATE_DIRECTORY=${input.stateDirectory}\nEG_BACKEND_ENV_FILE=${input.deploymentRoot}/kit/infra/docker/compose/.env\n`,
    { mode: 0o600 },
  );

  const template = JSON.parse(
    await readFile(
      resolve(repository, 'infra/docker/compose/plugin-manager.example.json'),
      'utf8',
    ),
  );
  await mkdir(resolve(output, 'config'), { recursive: true, mode: 0o700 });
  for (const architecture of ['amd64', 'arm64']) {
    for (const mode of ['compose_planner', 'compose_managed']) {
      const config = managerConfig(template, { ...input, architecture, mode });
      await writeFile(
        resolve(
          output,
          `config/manager-config.${mode}.${architecture}.json.example`,
        ),
        `${JSON.stringify(config, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
  }

  const files = await regularFiles(output);
  const components = [];
  for (const path of files) {
    components.push({ path, sha256: await sha256(resolve(output, path)) });
  }
  const manifest = {
    apiVersion: 'plugin-deployment-kit.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginComposeDeploymentKit',
    hostVersion: input.hostVersion,
    deploymentRoot: input.deploymentRoot,
    stateDirectory: input.stateDirectory,
    images: {
      backend: input.backendImage,
      frontend: input.frontendImage,
      pluginManager: input.managerImage,
    },
    components,
  };
  await writeFile(
    resolve(output, 'deployment-kit.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o644 },
  );
  return manifest;
}

async function main() {
  const values = argumentsFrom(process.argv.slice(2));
  const input = {
    output: required(values, 'output'),
    hostVersion: required(values, 'host-version'),
    backendImage: immutableReference(required(values, 'backend-image'), 'backend-image'),
    frontendImage: immutableReference(required(values, 'frontend-image'), 'frontend-image'),
    managerImage: immutableReference(required(values, 'manager-image'), 'manager-image'),
    deploymentRoot: absoluteDeploymentPath(
      values['deployment-root'] ?? '/opt/enterpriseglue/plugin-deployment',
      'deployment-root',
    ),
    stateDirectory: absoluteDeploymentPath(
      values['state-directory'] ?? '/opt/enterpriseglue/plugin-manager/state',
      'state-directory',
    ),
  };
  await buildPluginComposeDeploymentKit(input);
  process.stdout.write(`${resolve(input.output)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
