import { describe, it, expect, vi } from 'vitest';
import {
  listTasks,
  getTaskById,
  claimTaskById,
  completeTaskById,
  getTaskCountByQuery,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/tasks-service.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  getTasks: vi.fn().mockResolvedValue([]),
  getTask: vi.fn().mockResolvedValue({ id: 't1' }),
  getTaskCount: vi.fn().mockResolvedValue({ count: 1 }),
  claimTask: vi.fn().mockResolvedValue(undefined),
  completeTask: vi.fn().mockResolvedValue(undefined),
  unclaimTask: vi.fn().mockResolvedValue(undefined),
  setTaskAssignee: vi.fn().mockResolvedValue(undefined),
  getTaskVariables: vi.fn().mockResolvedValue({}),
  updateTaskVariables: vi.fn().mockResolvedValue(undefined),
  getTaskForm: vi.fn().mockResolvedValue({ key: 'form-1' }),
}));

describe('tasks-service', () => {
  it('lists tasks', async () => {
    const result = await listTasks('engine-1', {});
    expect(result).toEqual([]);
  });

  it('gets task by id', async () => {
    const result = await getTaskById('engine-1', 't1');
    expect(result).toEqual({ id: 't1' });
  });

  it('gets task count by query', async () => {
    const result = await getTaskCountByQuery('engine-1', {});
    expect(result).toEqual({ count: 1 });
  });

  it('claims task by id', async () => {
    await expect(claimTaskById('engine-1', 't1', { userId: 'u1' })).resolves.toBeUndefined();
  });

  it('completes task by id', async () => {
    await expect(completeTaskById('engine-1', 't1', { variables: {} })).resolves.toBeUndefined();
  });
});
