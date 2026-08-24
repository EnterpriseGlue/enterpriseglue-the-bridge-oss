import { resolve } from 'node:path';

import { runPluginInstallerCliV1 } from '@enterpriseglue/plugin-installer/cli';

import type { PluginManagerLifecyclePortV1 } from './manager.js';
import { assertPreparedPluginPlanMatchesV1 } from './planGate.js';

export interface ConnectedOciPluginLifecycleOptionsV1 {
  outputRoot: string;
  trustFile: string;
  cosignPolicyFile: string;
  hostVersion: string;
  execution: PluginManagerLifecyclePortV1;
  registryConfigFile?: string;
  registryCaFile?: string;
  permissionGrantsFile?: string;
  maximumDownloadBytes?: number;
  allowPlainHttp?: boolean;
  allowInsecureTls?: boolean;
  installer?: typeof runPluginInstallerCliV1;
  assertPreparedPlan?: typeof assertPreparedPluginPlanMatchesV1;
}

function optionalArgument(flag: string, value?: string): string[] {
  return value?.trim() ? [flag, value.trim()] : [];
}

export class ConnectedOciPluginLifecycleV1
  implements PluginManagerLifecyclePortV1
{
  private readonly installer: typeof runPluginInstallerCliV1;
  private readonly assertPreparedPlan: typeof assertPreparedPluginPlanMatchesV1;

  constructor(private readonly options: ConnectedOciPluginLifecycleOptionsV1) {
    this.installer = options.installer ?? runPluginInstallerCliV1;
    this.assertPreparedPlan =
      options.assertPreparedPlan ?? assertPreparedPluginPlanMatchesV1;
  }

  async execute(
    input: Parameters<PluginManagerLifecyclePortV1['execute']>[0],
  ): ReturnType<PluginManagerLifecyclePortV1['execute']> {
    if (
      input.intent.source !== 'connected_registry' &&
      input.intent.source !== 'static_catalog'
    ) {
      throw new Error('connected_lifecycle_source_invalid');
    }
    const output = resolve(this.options.outputRoot);
    const command = [
      input.intent.operation === 'upgrade' ? 'upgrade-oci' : 'install-oci',
      '--subject',
      input.release.package,
      '--trust',
      this.options.trustFile,
      '--cosign-policy',
      this.options.cosignPolicyFile,
      '--host-version',
      this.options.hostVersion,
      '--output',
      output,
      '--expected-plan-sha256',
      input.envelope.planSha256!,
      ...optionalArgument('--registry-config', this.options.registryConfigFile),
      ...optionalArgument('--registry-ca', this.options.registryCaFile),
      ...optionalArgument(
        '--permission-grants',
        this.options.permissionGrantsFile,
      ),
      ...(this.options.maximumDownloadBytes === undefined
        ? []
        : [
            '--max-download-bytes',
            String(this.options.maximumDownloadBytes),
          ]),
      ...(this.options.allowPlainHttp ? ['--allow-plain-http', 'true'] : []),
      ...(this.options.allowInsecureTls
        ? ['--allow-insecure-tls', 'true']
        : []),
    ];
    const exitCode = await this.installer(command, () => undefined);
    if (exitCode !== 0) {
      throw new Error('connected_oci_acquisition_failed');
    }
    await this.assertPreparedPlan(output, input.envelope);
    return this.options.execution.execute(input);
  }
}
