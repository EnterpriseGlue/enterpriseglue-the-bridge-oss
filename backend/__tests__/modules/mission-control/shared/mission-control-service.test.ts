import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getProcessInstanceVariables,
  getProcessInstanceVariableHistory,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
  camundaPost: vi.fn(),
  camundaPut: vi.fn(),
  camundaDelete: vi.fn(),
  setJobDuedate: vi.fn(),
  getExternalTasks: vi.fn(),
  setExternalTaskRetries: vi.fn(),
}));

describe('mission-control-service', () => {
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
});
