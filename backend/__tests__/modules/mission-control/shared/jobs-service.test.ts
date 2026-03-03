import { describe, it, expect, vi } from 'vitest';
import {
  listJobs,
  getJobById,
  executeJobById,
  setJobRetriesById,
  listJobDefinitions,
  setJobDefinitionRetriesById,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/jobs-service.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  getJobs: vi.fn().mockResolvedValue([]),
  getJob: vi.fn().mockResolvedValue({ id: 'j1' }),
  executeJob: vi.fn().mockResolvedValue(undefined),
  setJobRetries: vi.fn().mockResolvedValue(undefined),
  getJobDefinitions: vi.fn().mockResolvedValue([{ id: 'jd1' }]),
  setJobDefinitionRetries: vi.fn().mockResolvedValue(undefined),
  setJobSuspensionState: vi.fn().mockResolvedValue(undefined),
  setJobDefinitionSuspensionState: vi.fn().mockResolvedValue(undefined),
}));

describe('jobs-service', () => {
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
});
