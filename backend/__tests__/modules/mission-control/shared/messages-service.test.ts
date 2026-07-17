import { describe, it, expect, vi } from 'vitest';
import { sendMessage, sendSignal } from '../../../../../packages/backend-host/src/modules/mission-control/shared/messages-service.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  correlateMessage: vi.fn().mockResolvedValue([{ resultType: 'Execution', execution: { id: 'execution-1', processInstanceId: 'instance-1' } }]),
  deliverSignal: vi.fn().mockResolvedValue({ delivered: true }),
}));

describe('messages-service', () => {
  it('sends message', async () => {
    const result = await sendMessage('engine-1', { messageName: 'test' });
    expect(result).toEqual([{ resultType: 'Execution', execution: { id: 'execution-1', processInstanceId: 'instance-1' } }]);
  });

  it('sends signal', async () => {
    const result = await sendSignal('engine-1', { signalName: 'signal' });
    expect(result).toEqual({ delivered: true });
  });
});
