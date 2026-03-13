import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  camundaGet,
  getHistoricVariableInstances,
  getHistoricTaskInstances,
  getHistoricDecisionInstances,
  getUserOperationLog,
} from '@enterpriseglue/shared/services/bpmn-engine-client.js';

let getActivityCountsByState: typeof import('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js').getActivityCountsByState;
let getProcessInstanceVariables: typeof import('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js').getProcessInstanceVariables;
let getProcessInstanceVariableHistory: typeof import('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js').getProcessInstanceVariableHistory;
let getProcessInstanceExecutionDetails: typeof import('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js').getProcessInstanceExecutionDetails;

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
  camundaPost: vi.fn(),
  camundaPut: vi.fn(),
  camundaDelete: vi.fn(),
  setJobDuedate: vi.fn(),
  getExternalTasks: vi.fn(),
  setExternalTaskRetries: vi.fn(),
  getHistoricVariableInstances: vi.fn(),
  getHistoricTaskInstances: vi.fn(),
  getHistoricDecisionInstances: vi.fn(),
  getUserOperationLog: vi.fn(),
}));

describe('mission-control-service', () => {
  beforeAll(async () => {
    ({
      getActivityCountsByState,
      getProcessInstanceVariables,
      getProcessInstanceVariableHistory,
      getProcessInstanceExecutionDetails,
    } = await import('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only process-scope variables when execution scopes are present', async () => {
    vi.mocked(camundaGet).mockResolvedValueOnce([
      { name: 'requestBody', value: { foo: 'bar' }, type: 'Json', executionId: 'proc-1' },
      { name: 'validStatuses', value: ['ISSUED', 'LAPSED'], type: 'Object', executionId: 'activity-exec-42' },
    ] as any);

    const result = await getProcessInstanceVariables('engine-1', 'proc-1');

    expect(result).toEqual({
      requestBody: { value: { foo: 'bar' }, type: 'Json' },
    });
    expect(camundaGet).toHaveBeenCalledWith('engine-1', '/history/variable-instance', { processInstanceId: 'proc-1' });
  });

  it('keeps compatibility when executionId is not provided by engine response', async () => {
    vi.mocked(camundaGet).mockResolvedValueOnce([
      { name: 'legacyVar', value: 'ok', type: 'String' },
    ] as any);

    const result = await getProcessInstanceVariables('engine-1', 'proc-1');

    expect(result).toEqual({
      legacyVar: { value: 'ok', type: 'String' },
    });
  });

  it('returns sorted variable history detail rows when historic updates exist', async () => {
    vi.mocked(camundaGet).mockResolvedValueOnce([
      {
        id: 'detail-older',
        variableInstanceId: 'var-1',
        variableName: 'amount',
        value: 100,
        variableType: 'Integer',
        time: '2026-03-08T09:00:00.000Z',
        activityInstanceId: 'act-1',
        executionId: 'exec-1',
        revision: 1,
      },
      {
        id: 'detail-newer',
        variableInstanceId: 'var-1',
        variableName: 'amount',
        value: 200,
        variableType: 'Integer',
        time: '2026-03-08T10:00:00.000Z',
        activityInstanceId: 'act-1',
        executionId: 'exec-1',
        revision: 2,
      },
    ] as any);

    const result = await getProcessInstanceVariableHistory('engine-1', 'proc-1', 'var-1');

    expect(camundaGet).toHaveBeenCalledWith('engine-1', '/history/detail', {
      processInstanceId: 'proc-1',
      variableInstanceId: 'var-1',
      variableUpdates: true,
    });
    expect(result).toEqual([
      expect.objectContaining({ id: 'detail-newer', value: 200, revision: 2 }),
      expect.objectContaining({ id: 'detail-older', value: 100, revision: 1 }),
    ]);
  });

  it('falls back to historic variable snapshot when no detail rows exist', async () => {
    vi.mocked(camundaGet)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({
        id: 'var-1',
        name: 'amount',
        value: 250,
        type: 'Integer',
        createTime: '2026-03-08T08:00:00.000Z',
        activityInstanceId: 'act-2',
        executionId: 'exec-2',
        taskId: 'task-1',
      } as any);

    const result = await getProcessInstanceVariableHistory('engine-1', 'proc-1', 'var-1');

    expect(camundaGet).toHaveBeenNthCalledWith(1, 'engine-1', '/history/detail', {
      processInstanceId: 'proc-1',
      variableInstanceId: 'var-1',
      variableUpdates: true,
    });
    expect(camundaGet).toHaveBeenNthCalledWith(2, 'engine-1', '/history/variable-instance/var-1');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'var-1',
        variableInstanceId: 'var-1',
        variableName: 'amount',
        value: 250,
        revision: null,
      }),
    ]);
  });

  it('deduplicates canceled badge counts by process instance per activity', async () => {
    vi.mocked(camundaGet).mockImplementation(async (_engineId: string, path: string) => {
      if (path === '/process-definition/def-1/statistics') return [] as any;
      if (path === '/process-instance') return [] as any;
      if (path === '/history/activity-instance') {
        return [
          { activityId: 'approveInvoice', processInstanceId: 'proc-1' },
          { activityId: 'approveInvoice', processInstanceId: 'proc-1' },
          { activityId: 'approveInvoice', processInstanceId: 'proc-2' },
          { activityId: 'archiveInvoice', processInstanceId: 'proc-3' },
        ] as any;
      }
      return [] as any;
    });

    const result = await getActivityCountsByState('engine-1', 'def-1');

    expect(result.canceled).toEqual({
      approveInvoice: 2,
      archiveInvoice: 1,
    });
  });

  it('aggregates lazy execution details and filters tasks by taskId when provided', async () => {
    vi.mocked(getHistoricVariableInstances).mockResolvedValueOnce([
      { id: 'var-1', name: 'approvalReason', value: 'Need manager sign-off', type: 'String' },
    ] as any);
    vi.mocked(getHistoricTaskInstances).mockResolvedValueOnce([
      { id: 'task-1', name: 'Approve request', assignee: 'demo' },
      { id: 'task-2', name: 'Ignore me', assignee: 'demo' },
    ] as any);
    vi.mocked(getHistoricDecisionInstances).mockResolvedValueOnce([
      { id: 'decision-1', decisionDefinitionKey: 'risk-check' },
    ] as any);
    vi.mocked(getUserOperationLog).mockResolvedValueOnce([
      { id: 'op-1', operationType: 'ModifyVariable', property: 'approvalReason' },
    ] as any);

    const result = await getProcessInstanceExecutionDetails('engine-1', 'proc-1', {
      activityInstanceId: 'act-inst-1',
      executionId: 'exec-1',
      taskId: 'task-1',
    });

    expect(result).toEqual({
      activityInstanceId: 'act-inst-1',
      executionId: 'exec-1',
      taskId: 'task-1',
      variables: [{ id: 'var-1', name: 'approvalReason', value: 'Need manager sign-off', type: 'String' }],
      tasks: [{ id: 'task-1', name: 'Approve request', assignee: 'demo' }],
      decisions: [{ id: 'decision-1', decisionDefinitionKey: 'risk-check' }],
      userOperations: [{ id: 'op-1', operationType: 'ModifyVariable', property: 'approvalReason' }],
    });
    expect(getHistoricVariableInstances).toHaveBeenCalledWith('engine-1', expect.objectContaining({ processInstanceId: 'proc-1', activityInstanceIdIn: ['act-inst-1'] }));
    expect(getHistoricTaskInstances).toHaveBeenCalledWith('engine-1', expect.objectContaining({ processInstanceId: 'proc-1', activityInstanceIdIn: ['act-inst-1'] }));
    expect(getHistoricDecisionInstances).toHaveBeenCalledWith('engine-1', expect.objectContaining({ processInstanceId: 'proc-1', activityInstanceIdIn: ['act-inst-1'] }));
    expect(getUserOperationLog).toHaveBeenCalledWith('engine-1', expect.objectContaining({ processInstanceId: 'proc-1', executionId: 'exec-1' }));
  });
});
