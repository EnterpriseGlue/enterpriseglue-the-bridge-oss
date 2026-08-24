import type { PluginManagerLifecyclePortV1 } from './manager.js';

export class SourceAwarePluginLifecycleV1 implements PluginManagerLifecyclePortV1 {
  constructor(
    private readonly connected: PluginManagerLifecyclePortV1,
    private readonly offline: PluginManagerLifecyclePortV1,
  ) {}

  execute(
    input: Parameters<PluginManagerLifecyclePortV1['execute']>[0],
  ): ReturnType<PluginManagerLifecyclePortV1['execute']> {
    return input.intent.source === 'offline_delivery'
      ? this.offline.execute(input)
      : this.connected.execute(input);
  }
}
