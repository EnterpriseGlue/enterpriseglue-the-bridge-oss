#!/usr/bin/env node

import {
  createHash,
  generateKeyPairSync,
} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createPluginDeploymentExecutionObservationV1,
  createPluginLifecyclePlanEnvelopeV1,
  emptyPluginInstallerStateV1,
  installPluginV1,
  renderComposePluginOverlayV1,
  verifyPluginInstallInputV1,
} from '../packages/plugin-installer/dist/index.js';

const root = process.cwd();
const project = await mkdtemp(
  resolve(root, '.plugin-compose-lifecycle-'),
);
const output = resolve(project, 'generated/plugins');
const assets = resolve(project, 'assets/reference-health');
const baseCompose = resolve(project, 'compose.yaml');
const generatedCompose = resolve(
  output,
  'docker-compose.plugins.generated.yaml',
);
const projectName = `egpluginlifecycle${process.pid}`;
const service = 'eg-plugin-io-enterpriseglue-reference-health';
const gatewayNetwork = 'enterpriseglue-plugin-gateway';
const registryName = `eg-plugin-compose-registry-${process.pid}`;
const registryPort = Number(
  process.env.EG_PLUGIN_COMPOSE_REGISTRY_PORT ?? '5004',
);
const registryImage =
  process.env.EG_PLUGIN_COMPOSE_REGISTRY_IMAGE ??
  'registry:3.0.0@sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e';
let createdNetwork = false;
let registryStarted = false;
const publishedImages = [];

function command(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${(result.stderr || result.stdout)
        .trim()
        .slice(0, 1_000)}`,
    );
  }
  return result.stdout.trim();
}

function docker(args) {
  return command('docker', args);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function startRegistry() {
  if (
    !Number.isInteger(registryPort) ||
    registryPort < 1_024 ||
    registryPort > 65_535
  ) {
    throw new Error(
      'EG_PLUGIN_COMPOSE_REGISTRY_PORT must be an unprivileged TCP port',
    );
  }
  docker([
    'run',
    '--detach',
    '--name',
    registryName,
    '--publish',
    `127.0.0.1:${registryPort}:5000`,
    registryImage,
  ]);
  registryStarted = true;
  const registry = `127.0.0.1:${registryPort}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://${registry}/v2/`);
      if (response.ok) return registry;
    } catch {
      // The registry can take a moment to bind after Docker reports it running.
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 250),
    );
  }
  throw new Error('Disposable OCI registry did not become ready');
}

function resolvePublishedImage(tag, repository) {
  docker(['pull', tag]);
  const repoDigests = JSON.parse(
    docker(['image', 'inspect', tag, '--format', '{{json .RepoDigests}}']),
  );
  const reference = repoDigests.find((candidate) =>
    candidate.startsWith(`${repository}@sha256:`),
  );
  if (
    !reference ||
    !new RegExp(
      `^${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@sha256:[a-f0-9]{64}$`,
    ).test(reference)
  ) {
    throw new Error('Published OCI image did not produce an immutable digest');
  }
  publishedImages.push(tag, reference);
  return reference;
}

function publishImage(localImage, repository) {
  const tag = `${repository}:compose-lifecycle`;
  docker(['tag', localImage, tag]);
  docker(['push', tag]);
  return resolvePublishedImage(tag, repository);
}

function buildAndPublishImage(dockerfile, repository) {
  const tag = `${repository}:compose-lifecycle`;
  docker([
    'build',
    '--file',
    dockerfile,
    '--tag',
    tag,
    '.',
  ]);
  docker(['push', tag]);
  return resolvePublishedImage(tag, repository);
}

function wrapper(image, args) {
  return command(resolve(root, 'scripts/eg-plugin'), args, {
    env: {
      EG_PLUGIN_INSTALLER_IMAGE: image,
    },
  });
}

async function writeInitialOutput(state) {
  await mkdir(output, { recursive: true, mode: 0o700 });
  await mkdir(assets, { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync('ed25519');
  const privateKey = resolve(output, 'plugin-invocation-private.pem');
  const publicKey = resolve(output, 'plugin-invocation-public.pem');
  await writeFile(
    privateKey,
    pair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    { mode: 0o600 },
  );
  await writeFile(
    publicKey,
    pair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    { mode: 0o600 },
  );
  await writeFile(
    resolve(output, 'plugin-installer-state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
  const envelope = createPluginLifecyclePlanEnvelopeV1(
    state.revision,
    state.lifecyclePlan,
  );
  await writeFile(
    resolve(output, 'plugin-lifecycle-plan.json'),
    `${JSON.stringify(envelope, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    resolve(output, 'plugin-lifecycle-observation.json'),
    `${JSON.stringify(
      createPluginDeploymentExecutionObservationV1(
        envelope,
        null,
      ),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    generatedCompose,
    renderComposePluginOverlayV1(state, {
      stateSourcePath: resolve(
        output,
        'plugin-installer-state.json',
      ),
      executionObservationSourcePath: resolve(
        output,
        'plugin-lifecycle-observation.json',
      ),
      invocationPrivateKeySourcePath: privateKey,
      invocationPublicKeySourcePath: publicKey,
      deploymentFileSourceRoot: resolve(
        output,
        'plugin-config-files',
      ),
      secretBrokerPolicySourcePath: resolve(
        output,
        'plugin-secret-broker-policy.json',
      ),
      secretBrokerSecretRootSourcePath: resolve(
        output,
        'plugin-broker-secrets',
      ),
    }),
    { mode: 0o600 },
  );
}

async function main() {
  const reuseImages =
    process.env.EG_PLUGIN_LIFECYCLE_REUSE_IMAGES === 'true';
  const registry = await startRegistry();
  const pluginRepository = `${registry}/enterpriseglue/reference-health`;
  const installerRepository = `${registry}/enterpriseglue/plugin-installer`;
  const pluginImage = reuseImages
    ? publishImage(
        'enterpriseglue/reference-health:compose-lifecycle',
        pluginRepository,
      )
    : buildAndPublishImage(
        'packages/plugin-reference/Dockerfile',
        pluginRepository,
      );
  const installerImage = reuseImages
    ? publishImage(
        'enterpriseglue/plugin-installer:compose-lifecycle',
        installerRepository,
      )
    : buildAndPublishImage(
        'packages/plugin-installer/Dockerfile',
        installerRepository,
      );

  const networkExists =
    spawnSync(
      'docker',
      ['network', 'inspect', gatewayNetwork],
      { stdio: 'ignore' },
    ).status === 0;
  if (!networkExists) {
    docker(['network', 'create', gatewayNetwork]);
    createdNetwork = true;
  }

  const resources = JSON.parse(
    await readFile(
      resolve(root, 'packages/plugin-reference/deploy/resources.json'),
      'utf8',
    ),
  );
  const resourceBytes = Buffer.from(JSON.stringify(resources));
  const manifest = {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: 'io.enterpriseglue.reference-health',
      version: '0.1.0',
      displayName: 'Reference Health',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '>=0.4.0 <0.5.0',
      sdk: '^0.1.0',
      backendProtocol: 1,
      requiredSlots: [],
    },
    deployment: {
      backend: {
        image: pluginImage,
        healthPath: '/_plugin/health',
        readyPath: '/_plugin/ready',
        protocolPath: '/_plugin/capabilities',
        operations: [],
      },
      resources: {
        descriptor: 'deploy/resources.json',
        sha256: digest(resourceBytes),
      },
    },
    scope: {
      installation: 'deployment',
      enablement: 'deployment',
    },
    permissions: { required: [], optional: [] },
    network: { egressPolicy: 'none' },
    entitlement: { provider: 'none' },
    dependencies: [],
    conflicts: [],
    events: { subscriptions: [] },
    jobs: { fixedSchedules: [] },
    contributions: [],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const record = verifyPluginInstallInputV1({
    release: {
      version: '0.1.0',
      channel: 'stable',
      bundle: pluginImage,
      manifestSha256: digest(manifestBytes),
      hostCompatibility: '>=0.4.0 <0.5.0',
      testedHostVersions: ['0.4.6'],
      sdkCompatibility: '^0.1.0',
      revoked: false,
      revocationReasonCode: 'none',
    },
    manifest,
    manifestBytes,
    resources,
    resourceBytes,
    grantedPermissions: [],
    stagedAssetPath: `./${relative(root, assets).replaceAll('\\', '/')}`,
  });
  const state = installPluginV1(
    emptyPluginInstallerStateV1(),
    record,
    new Date().toISOString(),
  );
  await writeInitialOutput(state);
  await writeFile(
    baseCompose,
    `services:\n  backend:\n    image: ${pluginImage}\nnetworks:\n  ${gatewayNetwork}:\n    external: true\n    name: ${gatewayNetwork}\n`,
    { mode: 0o600 },
  );

  const outputArgument = relative(root, output);
  const projectArgument = relative(root, project);
  const applyArgs = [
    'apply-compose',
    '--output',
    outputArgument,
    '--project-directory',
    projectArgument,
    '--compose-files',
    'compose.yaml,generated/plugins/docker-compose.plugins.generated.yaml',
    '--project-name',
    projectName,
    '--image-mode',
    'local',
  ];
  wrapper(installerImage, applyArgs);

  wrapper(installerImage, [
    'enable',
    '--plugin',
    'io.enterpriseglue.reference-health',
    '--output',
    outputArgument,
  ]);
  const enabled = JSON.parse(wrapper(installerImage, applyArgs));
  if (enabled.status !== 'succeeded') {
    throw new Error('Compose enable lifecycle did not succeed');
  }
  const containerId = docker([
    'compose',
    '--project-directory',
    project,
    '--project-name',
    projectName,
    '--file',
    baseCompose,
    '--file',
    generatedCompose,
    'ps',
    '--quiet',
    service,
  ]);
  if (!containerId) throw new Error('Plugin container was not activated');
  const health = docker([
    'container',
    'inspect',
    containerId,
    '--format',
    '{{.State.Health.Status}}',
  ]);
  if (health !== 'healthy') {
    throw new Error(`Plugin container is not healthy: ${health}`);
  }

  wrapper(installerImage, [
    'disable',
    '--plugin',
    'io.enterpriseglue.reference-health',
    '--output',
    outputArgument,
  ]);
  const disabled = JSON.parse(wrapper(installerImage, applyArgs));
  if (disabled.status !== 'succeeded') {
    throw new Error('Compose disable lifecycle did not succeed');
  }
  const runningAfterDisable = docker([
    'compose',
    '--project-directory',
    project,
    '--project-name',
    projectName,
    '--file',
    baseCompose,
    '--file',
    generatedCompose,
    'ps',
    '--status',
    'running',
    '--quiet',
    service,
  ]);
  if (runningAfterDisable) {
    throw new Error('Plugin container remained running after disable');
  }

  wrapper(installerImage, [
    'uninstall',
    '--plugin',
    'io.enterpriseglue.reference-health',
    '--data-action',
    'export',
    '--output',
    outputArgument,
  ]);
  const uninstalled = JSON.parse(wrapper(installerImage, applyArgs));
  if (uninstalled.status !== 'succeeded') {
    throw new Error('Compose uninstall lifecycle did not succeed');
  }
  const exportDirectories = await readdir(
    resolve(output, 'plugin-data-exports'),
  );
  const exportRoot = resolve(
    output,
    'plugin-data-exports',
    exportDirectories[0],
  );
  const exportManifest = JSON.parse(
    await readFile(resolve(exportRoot, 'export-manifest.json'), 'utf8'),
  );
  if (
    exportManifest.kind !== 'EnterpriseGluePluginDataExport' ||
    exportManifest.artifacts?.[0]?.sizeBytes < 1
  ) {
    throw new Error('Compose uninstall export evidence is invalid');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      installApplied: true,
      enabledHealthy: true,
      disabledStopped: true,
      uninstallExported: true,
      executionReceipts: (
        await readdir(resolve(output, 'plugin-lifecycle-effects'))
      ).length,
    }),
  );
}

let passed = false;
try {
  await main();
  passed = true;
} finally {
  if (!passed && process.env.EG_PLUGIN_KEEP_FAILED === 'true') {
    console.error(`Preserved failed lifecycle fixture at ${project}`);
    process.exitCode = 1;
  } else {
    spawnSync(
      'docker',
      [
        'compose',
        '--project-directory',
        project,
        '--project-name',
        projectName,
        '--file',
        baseCompose,
        '--file',
        generatedCompose,
        'down',
        '--remove-orphans',
        '--volumes',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    if (createdNetwork) {
      spawnSync('docker', ['network', 'rm', gatewayNetwork], {
        stdio: 'ignore',
      });
    }
    if (registryStarted) {
      spawnSync('docker', ['rm', '--force', registryName], {
        stdio: 'ignore',
      });
    }
    if (publishedImages.length > 0) {
      spawnSync(
        'docker',
        ['image', 'rm', '--force', ...publishedImages],
        { stdio: 'ignore' },
      );
    }
    await rm(project, { recursive: true, force: true });
  }
}
