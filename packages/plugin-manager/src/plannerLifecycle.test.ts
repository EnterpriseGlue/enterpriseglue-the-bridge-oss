import { describe, expect, it } from 'vitest';

import { OperatorAppliedPluginLifecycleV1 } from './plannerLifecycle.js';

describe('operator-applied Compose lifecycle', () => {
  it('stops after verified rendering without claiming deployment effects', async () => {
    const lifecycle = new OperatorAppliedPluginLifecycleV1(
      () => new Date('2026-08-24T00:00:00.000Z'),
    );
    await expect(lifecycle.execute()).resolves.toEqual({
      status: 'manual_intervention',
      reasonCode: 'operator_apply_required',
      occurredAt: '2026-08-24T00:00:00.000Z',
    });
  });
});
