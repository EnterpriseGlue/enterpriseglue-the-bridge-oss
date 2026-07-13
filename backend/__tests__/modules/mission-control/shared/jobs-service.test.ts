import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  listJobs,
  getJobById,
  executeJobById,
  setJobRetriesById,
  listJobDefinitions,
  setJobDefinitionRetriesById,
  filterRuntimeItemsByProcessDefinitionKeys,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/jobs-service.js';
import {
  getBoundedRuntimeFetchAndLockRequest,
  getBoundedRuntimeResourceQuery,
  MAX_RUNTIME_RESOURCE_PAGE_SIZE,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/runtime-resource-filter.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  getJobs: vi.fn().mockResolvedValue([]),
  getJob: vi.fn().mockResolvedValue({ id: 'j1' }),
  executeJob: vi.fn().mockResolvedValue(undefined),
  setJobRetries: vi.fn().mockResolvedValue(undefined),
  getJobDefinitions: vi.fn().mockResolvedValue([{ id: 'jd1' }]),
  camundaGet: vi.fn(),
  setJobDefinitionRetries: vi.fn().mockResolvedValue(undefined),
  setJobSuspensionState: vi.fn().mockResolvedValue(undefined),
  setJobDefinitionSuspensionState: vi.fn().mockResolvedValue(undefined),
}));

describe('jobs-service', () => {
  beforeEach(async () => {
    const { camundaGet } = await import('@enterpriseglue/shared/services/bpmn-engine-client.js');
    vi.mocked(camundaGet).mockReset();
  });
  it('lists jobs', async () => {
    const result = await listJobs('engine-1', {});
    expect(result).toEqual([]);
  });

  it('gets job by id', async () => {
    const result = await getJobById('engine-1', 'j1');
    expect(result).toEqual({ id: 'j1' });
  });

  it('executes job by id', async () => {
    await expect(executeJobById('engine-1', 'j1')).resolves.toBeUndefined();
  });

  it('sets job retries by id', async () => {
    await expect(setJobRetriesById('engine-1', 'j1', { retries: 3 })).resolves.toBeUndefined();
  });

  it('lists job definitions', async () => {
    const result = await listJobDefinitions('engine-1', {});
    expect(result).toEqual([{ id: 'jd1' }]);
  });

  it('sets job definition retries by id', async () => {
    await expect(setJobDefinitionRetriesById('engine-1', 'jd1', { retries: 2 })).resolves.toBeUndefined();
  });

  it('filters jobs by their process definition keys on resource-aware engines', async () => {
    const { camundaGet } = await import('@enterpriseglue/shared/services/bpmn-engine-client.js');
    vi.mocked(camundaGet)
      .mockResolvedValueOnce({ id: 'definition-payments', key: 'payments' })
      .mockResolvedValueOnce({ id: 'definition-hr', key: 'hr' });

    const result = await filterRuntimeItemsByProcessDefinitionKeys('engine-1', [
      { id: 'job-1', processDefinitionId: 'definition-payments' },
      { id: 'job-2', processDefinitionId: 'definition-hr' },
      { id: 'job-3' },
    ], ['payments']);

    expect(result).toEqual([{ id: 'job-1', processDefinitionId: 'definition-payments' }]);
    expect(camundaGet).toHaveBeenCalledWith('engine-1', '/process-definition/definition-payments');
    expect(camundaGet).toHaveBeenCalledWith('engine-1', '/process-definition/definition-hr');
  });

  it('fails closed when a resource-aware engine ignores the bounded result limit', async () => {
    await expect(filterRuntimeItemsByProcessDefinitionKeys(
      'engine-1',
      Array.from({ length: MAX_RUNTIME_RESOURCE_PAGE_SIZE + 1 }, (_, index) => ({
        id: `job-${index}`,
        processDefinitionId: `definition-${index}`,
      })),
      ['payments'],
    )).rejects.toMatchObject({
      code: 'runtime_filter_not_supported',
      statusCode: 403,
    });

    const { camundaGet } = await import('@enterpriseglue/shared/services/bpmn-engine-client.js');
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('normalizes omitted resource-aware result limits and rejects unsafe limits', () => {
    expect(getBoundedRuntimeResourceQuery({ processDefinitionKey: 'payments' })).toEqual({
      processDefinitionKey: 'payments',
      maxResults: MAX_RUNTIME_RESOURCE_PAGE_SIZE,
    });
    expect(() => getBoundedRuntimeResourceQuery({ maxResults: MAX_RUNTIME_RESOURCE_PAGE_SIZE + 1 })).toThrow(
      'Resource-aware runtime queries require maxResults',
    );
  });

  it('normalizes resource-aware fetch-and-lock limits and rejects unsafe limits', () => {
    expect(getBoundedRuntimeFetchAndLockRequest({ topics: [] })).toEqual({
      topics: [],
      maxTasks: MAX_RUNTIME_RESOURCE_PAGE_SIZE,
    });
    expect(() => getBoundedRuntimeFetchAndLockRequest({ maxTasks: MAX_RUNTIME_RESOURCE_PAGE_SIZE + 1 })).toThrow(
      'Resource-aware external task fetches require maxTasks',
    );
  });
});
