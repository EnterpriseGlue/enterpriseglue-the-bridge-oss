import { describe, it, expect, vi } from 'vitest';
import { sendMessage, sendSignal } from '../../../../src/modules/mission-control/shared/messages-service.js';

vi.mock('@shared/services/bpmn-engine-client.js', () => ({
  correlateMessage: vi.fn().mockResolvedValue({ result: 'ok' }),
  deliverSignal: vi.fn().mockResolvedValue({ delivered: true }),
}));

describe('messages-service', () => {
  it('sends message', async () => {
    const result = await sendMessage('engine-1', { messageName: 'test' });
    expect(result).toEqual({ result: 'ok' });
  });

  it('sends signal', async () => {
    const result = await sendSignal('engine-1', { signalName: 'signal' });
    expect(result).toEqual({ delivered: true });
  });
});
