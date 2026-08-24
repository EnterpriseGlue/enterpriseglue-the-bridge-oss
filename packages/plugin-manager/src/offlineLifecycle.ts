import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { runPluginInstallerCliV1 } from '@enterpriseglue/plugin-installer/cli';

import type { PluginManagerLifecyclePortV1 } from './manager.js';
import { assertPreparedPluginPlanMatchesV1 } from './planGate.js';

export interface OfflineDeliveryPluginLifecycleOptionsV1 {
  intakeRoot: string;
  outputRoot: string;
  trustFile: string;
  hostVersion: string;
  execution: PluginManagerLifecyclePortV1;
  registryConfigFile?: string;
  registryCaFile?: string;
  permissionGrantsFile?: string;
  allowPlainHttp?: boolean;
  allowInsecureTls?: boolean;
  installer?: typeof runPluginInstallerCliV1;
  assertPreparedPlan?: typeof assertPreparedPluginPlanMatchesV1;
}

function optionalArgument(flag: string, value?: string): string[] {
  return value?.trim() ? [flag, value.trim()] : [];
}

export class OfflineDeliveryPluginLifecycleV1
  implements PluginManagerLifecyclePortV1
{
  private readonly installer: typeof runPluginInstallerCliV1;
  private readonly assertPreparedPlan: typeof assertPreparedPluginPlanMatchesV1;

  constructor(private readonly options: OfflineDeliveryPluginLifecycleOptionsV1) {
    this.installer = options.installer ?? runPluginInstallerCliV1;
    this.assertPreparedPlan =
      options.assertPreparedPlan ?? assertPreparedPluginPlanMatchesV1;
  }

  async execute(
    input: Parameters<PluginManagerLifecyclePortV1['execute']>[0],
  ): ReturnType<PluginManagerLifecyclePortV1['execute']> {
    if (input.intent.source !== 'offline_delivery') {
      throw new Error('offline_lifecycle_source_invalid');
    }
    const digest = input.intent.release.slice(input.intent.release.lastIndexOf(':') + 1);
    const intakeRoot = await realpath(resolve(this.options.intakeRoot));
    const delivery = await realpath(resolve(intakeRoot, `sha256-${digest}`));
    if (delivery === intakeRoot || !delivery.startsWith(`${intakeRoot}${sep}`)) {
      throw new Error('offline_delivery_path_invalid');
    }
    const deliveryDetails = await lstat(delivery);
    if (!deliveryDetails.isDirectory() || deliveryDetails.isSymbolicLink()) {
      throw new Error('offline_delivery_directory_invalid');
    }
    const airgap = resolve(delivery, 'airgap');
    const registryMap = resolve(delivery, 'airgap-registry-map.json');
    for (const path of [airgap, registryMap]) {
      const details = await lstat(path);
      if (details.isSymbolicLink() || (!details.isDirectory() && !details.isFile())) {
        throw new Error('offline_delivery_entry_invalid');
      }
    }

    const common = [
      '--airgap', airgap,
      '--trust', this.options.trustFile,
      '--host-version', this.options.hostVersion,
      '--registry-map', registryMap,
      ...optionalArgument('--registry-config', this.options.registryConfigFile),
      ...optionalArgument('--registry-ca', this.options.registryCaFile),
      ...(this.options.allowPlainHttp ? ['--allow-plain-http', 'true'] : []),
      ...(this.options.allowInsecureTls ? ['--allow-insecure-tls', 'true'] : []),
    ];
    const importExitCode = await this.installer(['import-airgap', ...common], () => undefined);
    if (importExitCode !== 0) throw new Error('offline_delivery_import_failed');
    const installExitCode = await this.installer([
      input.intent.operation === 'upgrade'
        ? 'upgrade-airgap-package'
        : 'install-airgap-package',
      ...common,
      ...optionalArgument('--permission-grants', this.options.permissionGrantsFile),
      '--output', resolve(this.options.outputRoot),
      '--expected-plan-sha256', input.envelope.planSha256!,
    ], () => undefined);
    if (installExitCode !== 0) throw new Error('offline_delivery_install_failed');
    await this.assertPreparedPlan(
      resolve(this.options.outputRoot),
      input.envelope,
    );
    return this.options.execution.execute(input);
  }
}
