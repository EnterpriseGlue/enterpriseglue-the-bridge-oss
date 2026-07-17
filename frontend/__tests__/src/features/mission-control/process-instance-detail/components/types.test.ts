import { describe, it, expect } from 'vitest';
import type { ProcessDefinition, Variable, ActivityInstance, VariableHistoryEntry } from '@src/features/mission-control/process-instance-detail/components/types';

describe('process-instance-detail types', () => {
  it('allows constructing type shapes', () => {
    const def: ProcessDefinition = { id: 'd1', key: 'proc', name: 'Proc', version: 1 };
    const variable: Variable = { id: 'variable-1', name: 'x', type: 'String', value: 'y' };
    const activity: ActivityInstance = { id: 'a1', activityId: 'task1' };
    const variableHistory: VariableHistoryEntry = { id: 'detail-1', variableInstanceId: 'variable-1', variableName: 'x', value: 'y' };

    expect(def.key).toBe('proc');
    expect(variable.type).toBe('String');
    expect(activity.activityId).toBe('task1');
    expect(variableHistory.variableName).toBe('x');
  });
});
