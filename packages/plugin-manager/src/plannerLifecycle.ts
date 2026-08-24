import type { PluginManagerLifecyclePortV1 } from './manager.js';

/**
 * Connected acquisition still verifies and renders the deployment-owned files,
 * but planner mode deliberately stops before any Docker/Kubernetes mutation.
 */
export class OperatorAppliedPluginLifecycleV1
  implements PluginManagerLifecyclePortV1
{
  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute(): ReturnType<PluginManagerLifecyclePortV1['execute']> {
    return {
      status: 'manual_intervention',
      reasonCode: 'operator_apply_required',
      occurredAt: this.now().toISOString(),
    };
  }
}
