import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getProcessInstanceVariables } from '../../../../src/modules/mission-control/shared/mission-control-service.js';
import { camundaGet } from '@shared/services/bpmn-engine-client.js';

vi.mock('@shared/services/bpmn-engine-client.js', () => ({
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
});
