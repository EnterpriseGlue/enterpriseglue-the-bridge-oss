import { describe, it, expect, vi } from 'vitest';
import { listMetrics, getMetric } from '../../../../../packages/backend-host/src/modules/mission-control/shared/metrics-service.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  getMetrics: vi.fn().mockResolvedValue([{ name: 'metric-1' }]),
  getMetricByName: vi.fn().mockResolvedValue({ name: 'metric-1', value: 2 }),
}));

describe('metrics-service', () => {
  it('lists metrics', async () => {
    const result = await listMetrics('engine-1', { from: 'now-1d' });
    expect(result).toEqual([{ name: 'metric-1' }]);
  });

  it('gets metric by name', async () => {
    const result = await getMetric('engine-1', 'metric-1', { from: 'now-1d' });
    expect(result).toEqual({ name: 'metric-1', value: 2 });
  });
});
