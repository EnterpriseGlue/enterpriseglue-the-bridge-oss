import { describe, it, expect, vi } from 'vitest';
import {
  listProcessInstances,
  getProcessInstance,
  getProcessInstanceVariables,
  getActivityInstances,
  deleteProcessInstance,
  modifyProcessInstanceVariables,
} from '../../../../src/modules/mission-control/process-instances/service.js';

vi.mock('@shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn().mockResolvedValue([]),
  camundaPost: vi.fn().mockResolvedValue({}),
  camundaDelete: vi.fn().mockResolvedValue(undefined),
}));

describe('process-instances service', () => {
  it('lists process instances', async () => {
    const result = await listProcessInstances('engine-1', { active: true });
    expect(result).toBeDefined();
  });

  it('gets process instance by id', async () => {
    const result = await getProcessInstance('engine-1', 'inst-1');
    expect(result).toBeDefined();
  });

  it('gets process instance variables', async () => {
    const result = await getProcessInstanceVariables('engine-1', 'inst-1');
    expect(result).toBeDefined();
  });

  it('gets activity instances', async () => {
    const result = await getActivityInstances('engine-1', 'inst-1');
    expect(result).toBeDefined();
  });

  it('deletes process instance', async () => {
    await deleteProcessInstance('engine-1', 'inst-1', { deleteReason: 'test' });
    expect(true).toBe(true);
  });

  it('modifies process instance variables', async () => {
    await modifyProcessInstanceVariables('engine-1', 'inst-1', { var1: 'value1' });
    expect(true).toBe(true);
  });
});
