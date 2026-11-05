import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BpmnEngineOperationError, camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { readLiveProcessVariables } from '../../../../../packages/backend-host/src/modules/mission-control/shared/runtime-process-variables.js';
import { processInstanceLookupError } from '../../../../../packages/backend-host/src/modules/mission-control/shared/process-instance-lookup-error.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('@enterpriseglue/shared/services/bpmn-engine-client.js')>(),
  camundaGet: vi.fn(),
}));
const error = (status: number) => new BpmnEngineOperationError({ method: 'GET', path: '/process-instance/instance/variables', status });
describe('live process variable identity', () => {
  beforeEach(() => vi.mocked(camundaGet).mockReset());
  it('reads variables only after the exact same-engine live parent succeeds', async () => {
    vi.mocked(camundaGet).mockResolvedValueOnce({ id: 'instance' } as any).mockResolvedValueOnce({ amount: { type: 'Integer', value: 84 } } as any);
    expect(await readLiveProcessVariables('engine-a', 'instance')).toEqual({ amount: { type: 'Integer', value: 84 } });
    expect(vi.mocked(camundaGet).mock.calls).toEqual([['engine-a', '/process-instance/instance'], ['engine-a', '/process-instance/instance/variables']]);
  });
  it('returns the typed parent not-found before invoking the engine variables endpoint', async () => {
    const missing = error(404); vi.mocked(camundaGet).mockRejectedValueOnce(missing);
    await expect(readLiveProcessVariables('engine-a', 'instance')).rejects.toBe(missing);
    expect(camundaGet).toHaveBeenCalledTimes(1);
    expect((processInstanceLookupError(missing) as any).statusCode).toBe(404);
  });
  it('rejects a mismatched parent identity before variable access', async () => {
    vi.mocked(camundaGet).mockResolvedValueOnce({ id: 'foreign-instance' } as any);
    await expect(readLiveProcessVariables('engine-a', 'instance')).rejects.toThrow('Runtime process identity');
    expect(camundaGet).toHaveBeenCalledTimes(1);
  });
  it('classifies an end-during-read race only after a typed parent 404', async () => {
    const missing = error(404);
    vi.mocked(camundaGet).mockResolvedValueOnce({ id: 'instance' } as any).mockRejectedValueOnce(error(500)).mockRejectedValueOnce(missing);
    await expect(readLiveProcessVariables('engine-a', 'instance')).rejects.toBe(missing);
    expect(vi.mocked(camundaGet).mock.calls.map(([, path]) => path)).toEqual(['/process-instance/instance', '/process-instance/instance/variables', '/process-instance/instance']);
  });
  it('preserves a genuine variable-server error when the live parent still exists', async () => {
    const failure = error(500);
    vi.mocked(camundaGet).mockResolvedValueOnce({ id: 'instance' } as any).mockRejectedValueOnce(failure).mockResolvedValueOnce({ id: 'instance' } as any);
    await expect(readLiveProcessVariables('engine-a', 'instance')).rejects.toBe(failure);
    expect(processInstanceLookupError(failure)).toBe(failure);
  });
  for (const status of [401, 403, 429, 503]) it(`preserves ${status} without further engine reads`, async () => {
    const failure = error(status);
    vi.mocked(camundaGet).mockResolvedValueOnce({ id: 'instance' } as any).mockRejectedValueOnce(failure);
    await expect(readLiveProcessVariables('engine-a', 'instance')).rejects.toBe(failure);
    expect(camundaGet).toHaveBeenCalledTimes(2);
    expect(processInstanceLookupError(failure)).toBe(failure);
  });
  it('does not treat an untyped 404 lookalike as evidence of absence', async () => {
    const failure = error(500), lookalike = { details: { operationClass: 'engine.read', engineStatus: 404 } };
    vi.mocked(camundaGet).mockResolvedValueOnce({ id: 'instance' } as any).mockRejectedValueOnce(failure).mockRejectedValueOnce(lookalike);
    await expect(readLiveProcessVariables('engine-a', 'instance')).rejects.toBe(failure);
  });
});
