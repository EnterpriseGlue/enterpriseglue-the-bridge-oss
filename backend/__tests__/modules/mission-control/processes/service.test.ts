import { beforeEach, describe, expect, it, vi } from 'vitest';
import { camundaGet, camundaPost } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  getProcessDefinitionStatistics,
  listProcessDefinitions,
  startProcessInstance,
} from '../../../../../packages/backend-host/src/modules/mission-control/processes/service.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
  camundaPost: vi.fn(),
}));

describe('processes service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(camundaGet).mockResolvedValue([]);
    vi.mocked(camundaPost).mockResolvedValue({ id: 'pi1' });
  });

  it('pushes definition collection runtime-tenant filters to the engine', async () => {
    await listProcessDefinitions('engine-1', {
      key: 'invoice',
      tenantIdIn: ['runtime-a'],
      latestVersion: true,
      maxResults: 25,
    });

    expect(camundaGet).toHaveBeenCalledWith('engine-1', '/process-definition', {
      key: 'invoice',
      tenantIdIn: ['runtime-a'],
      latestVersion: true,
      maxResults: 25,
    });
  });

  it('scopes process statistics to one runtime tenant or the no-tenant partition', async () => {
    await getProcessDefinitionStatistics('engine-1', 'invoice', 'runtime-a');
    expect(camundaGet).toHaveBeenNthCalledWith(1, 'engine-1', '/process-instance', {
      processDefinitionKey: 'invoice',
      active: true,
      tenantIdIn: ['runtime-a'],
    });

    await getProcessDefinitionStatistics('engine-1', 'invoice', '');
    expect(camundaGet).toHaveBeenNthCalledWith(2, 'engine-1', '/process-instance', {
      processDefinitionKey: 'invoice',
      active: true,
      withoutTenantId: true,
    });
  });

  it('uses the tenant-specific start endpoint for a mapped shared runtime tenant', async () => {
    await startProcessInstance(
      'engine-1',
      'invoice',
      { businessKey: 'order-1' },
      'runtime/a',
    );

    expect(camundaPost).toHaveBeenCalledWith(
      'engine-1',
      '/process-definition/key/invoice/tenant-id/runtime%2Fa/start',
      { businessKey: 'order-1' },
    );
  });

  it('retains the standard start endpoint for dedicated and no-tenant definitions', async () => {
    await startProcessInstance('engine-1', 'invoice', {});
    await startProcessInstance('engine-1', 'invoice', {}, '');

    expect(camundaPost).toHaveBeenNthCalledWith(
      1,
      'engine-1',
      '/process-definition/key/invoice/start',
      {},
    );
    expect(camundaPost).toHaveBeenNthCalledWith(
      2,
      'engine-1',
      '/process-definition/key/invoice/start',
      {},
    );
  });
});
