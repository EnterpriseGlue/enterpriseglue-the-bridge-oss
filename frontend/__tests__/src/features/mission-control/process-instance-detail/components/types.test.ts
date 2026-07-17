import { describe, it, expect } from 'vitest';
import type { ProcessDefinition, Variable, ActivityInstance } from '@src/features/mission-control/process-instance-detail/components/types';

describe('process-instance-detail types', () => {
  it('allows constructing type shapes', () => {
    const def: ProcessDefinition = { id: 'd1', key: 'proc', name: 'Proc', version: 1 };
    const variable: Variable = { id: 'variable-1', name: 'x', type: 'String', value: 'y' };
    const activity: ActivityInstance = { id: 'a1', activityId: 'task1' };

    expect(def.key).toBe('proc');
    expect(variable.type).toBe('String');
    expect(activity.activityId).toBe('task1');
  });
});
