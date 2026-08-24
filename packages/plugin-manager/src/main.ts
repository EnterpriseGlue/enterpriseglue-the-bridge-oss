import {
  ComposePluginLifecyclePhaseAdapterV1,
  KubernetesPluginLifecyclePhaseAdapterV1,
  type PluginLifecyclePhaseAdapterV1,
} from '@enterpriseglue/plugin-installer';
import { pathToFileURL } from 'node:url';

import { ConnectedOciPluginLifecycleV1 } from './connectedLifecycle.js';
import { pluginManagerBootstrapConfigV1Schema } from './config.js';
import { HttpPluginManagerHostV1 } from './hostClient.js';
import { FileInstallerLifecycleV1 } from './installerLifecycle.js';
import { NativePluginManagerV1 } from './manager.js';
import { OfflineDeliveryPluginLifecycleV1 } from './offlineLifecycle.js';
import { OperatorAppliedPluginLifecycleV1 } from './plannerLifecycle.js';
import {
  FilePluginReleaseResolverV1,
  OciPluginReleaseResolverV1,
  SourceAwarePluginReleaseResolverV1,
} from './releaseResolver.js';
import { SourceAwarePluginLifecycleV1 } from './sourceLifecycle.js';
import { readManagerSecureTextFileV1 } from './secureFile.js';
import { createPluginManagerServiceV1 } from './service.js';

function configuredAdapter(
  config: ReturnType<typeof pluginManagerBootstrapConfigV1Schema.parse>,
): PluginLifecyclePhaseAdapterV1 {
  const adapter = config.adapter;
  if (adapter.type === 'compose') {
    return new ComposePluginLifecyclePhaseAdapterV1({
      outputDirectory: config.storage.installerOutput,
      projectDirectory: adapter.projectDirectory,
      composeFiles: adapter.composeFiles,
      projectName: adapter.projectName,
      utilityImage: adapter.utilityImage,
      imageMode: adapter.imageMode,
    });
  }
  return new KubernetesPluginLifecyclePhaseAdapterV1({
    outputDirectory: config.storage.installerOutput,
    projectDirectory: adapter.projectDirectory,
    chartPath: adapter.chartPath,
    valuesFile: adapter.valuesFile,
    namespace: adapter.namespace,
    releaseName: adapter.releaseName,
    utilityImage: adapter.utilityImage,
    context: adapter.context,
    artifactStorageMiB: adapter.artifactStorageMiB,
    storageClassName: adapter.storageClassName,
    imagePullSecrets: adapter.imagePullSecrets,
    rolloutTimeoutSeconds: adapter.rolloutTimeoutSeconds,
    runAsUser: adapter.type === 'openshift' ? null : 65_532,
  });
}

export async function runPluginManagerMainV1(): Promise<void> {
  const configFile = process.env.ENTERPRISEGLUE_PLUGIN_MANAGER_CONFIG_FILE?.trim();
  if (!configFile) {
    throw new Error('ENTERPRISEGLUE_PLUGIN_MANAGER_CONFIG_FILE is required');
  }
  const config = pluginManagerBootstrapConfigV1Schema.parse(
    JSON.parse(await readManagerSecureTextFileV1(configFile, 1024 ** 2)),
  );
  const host = new HttpPluginManagerHostV1({
    baseUrl: config.host.baseUrl,
    workloadToken: async () =>
      (
        await readManagerSecureTextFileV1(
          config.host.workloadTokenFile,
          8 * 1024,
        )
      ).trim(),
  });
  const execution = new FileInstallerLifecycleV1({
    root: config.storage.executionRoot,
    adapter: configuredAdapter(config),
  });
  const manager = new NativePluginManagerV1({
    capability: {
      ...config.capability,
      observedAt: new Date().toISOString(),
    },
    environment: {
      hostVersion: config.host.version,
      hostArtifact: config.host.artifact,
      hostApiVersion: config.host.apiVersion,
      sdkVersion: config.host.sdkVersion,
      platformRevision: config.host.platformRevision,
      deploymentMode: config.deployment.mode,
      platform: config.deployment.platform,
      architecture: config.deployment.architecture,
      database: config.host.database,
      entitlementState: config.host.entitlementState,
    },
    host,
    releases: new SourceAwarePluginReleaseResolverV1(
      new OciPluginReleaseResolverV1({
        trustFile: config.connectedRegistry.trustFile,
        cosignPolicyFile: config.connectedRegistry.cosignPolicyFile,
        registryConfigFile: config.connectedRegistry.registryConfigFile,
        registryCaFile: config.connectedRegistry.registryCaFile,
        maximumDownloadBytes: config.connectedRegistry.maximumDownloadBytes,
        allowPlainHttp: config.connectedRegistry.allowPlainHttp,
        allowInsecureTls: config.connectedRegistry.allowInsecureTls,
      }),
      new FilePluginReleaseResolverV1({
        root: config.storage.releaseRoot,
        trustFile: config.connectedRegistry.trustFile,
      }),
    ),
    lifecycle: new SourceAwarePluginLifecycleV1(new ConnectedOciPluginLifecycleV1({
      outputRoot: config.storage.installerOutput,
      trustFile: config.connectedRegistry.trustFile,
      cosignPolicyFile: config.connectedRegistry.cosignPolicyFile,
      registryConfigFile: config.connectedRegistry.registryConfigFile,
      registryCaFile: config.connectedRegistry.registryCaFile,
      permissionGrantsFile: config.connectedRegistry.permissionGrantsFile,
      maximumDownloadBytes: config.connectedRegistry.maximumDownloadBytes,
      allowPlainHttp: config.connectedRegistry.allowPlainHttp,
      allowInsecureTls: config.connectedRegistry.allowInsecureTls,
      hostVersion: config.host.version,
      execution:
        config.deployment.mode === 'compose_planner'
          ? new OperatorAppliedPluginLifecycleV1()
          : execution,
    }), new OfflineDeliveryPluginLifecycleV1({
      intakeRoot: config.offlineDelivery.intakeRoot,
      outputRoot: config.storage.installerOutput,
      trustFile: config.connectedRegistry.trustFile,
      hostVersion: config.host.version,
      registryConfigFile: config.offlineDelivery.registryConfigFile,
      registryCaFile: config.offlineDelivery.registryCaFile,
      permissionGrantsFile: config.offlineDelivery.permissionGrantsFile,
      allowPlainHttp: config.offlineDelivery.allowPlainHttp,
      allowInsecureTls: config.offlineDelivery.allowInsecureTls,
      execution:
        config.deployment.mode === 'compose_planner'
          ? new OperatorAppliedPluginLifecycleV1()
          : execution,
    })),
  });
  const service = createPluginManagerServiceV1({
    manager,
    ...config.service,
  });
  let stopping: Promise<void> | undefined;
  const stop = async () => {
    stopping ??= service.stop().then(() => {
      process.exitCode = 0;
    });
    await stopping;
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  await service.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPluginManagerMainV1().catch(() => {
    console.error('plugin_manager_start_failed');
    process.exitCode = 1;
  });
}
