import { describe, expect, it } from 'vitest';
import { ProcessInstanceDetailSchema, ProcessInstanceSchema, RuntimeActivityInstanceTreeSchema } from '@enterpriseglue/shared/schemas/mission-control/process.js';

describe('process instance transport contract', () => {
  it('keeps every normalized runtime state and adapter extension', () => {
    const instance = ProcessInstanceSchema.parse({
      id: 'instance-1',
      processDefinitionKey: 'payments',
      businessKey: 'order-42',
      version: 3,
      state: 'SUSPENDED',
      hasIncident: true,
      adapterDiagnostic: 'retained',
    });
    expect(instance).toMatchObject({ state: 'SUSPENDED', hasIncident: true, adapterDiagnostic: 'retained' });
  });

  it('validates recursive runtime activity trees while retaining adapter diagnostics', () => {
    const tree = RuntimeActivityInstanceTreeSchema.parse({ id: 'root', activityId: 'start', childActivityInstances: [{ id: 'child', activityId: 'task', adapterDiagnostic: true }] });
    expect(tree.childActivityInstances?.[0]).toMatchObject({ id: 'child', adapterDiagnostic: true });
  });

  it('keeps detail identifiers, action decisions, and adapter extensions in one contract', () => {
    const detail = ProcessInstanceDetailSchema.parse({
      id: 'instance-1',
      processDefinitionId: 'payments:3:abc',
      definitionId: 'payments:3:abc',
      processDefinitionKey: 'payments',
      runtimeActionDecisions: {
        suspension: { allowed: true }, retry: { allowed: false, reason: 'Denied' }, terminate: { allowed: false },
      },
      engineDiagnostic: { retained: true },
    });
    expect(detail).toMatchObject({ processDefinitionId: 'payments:3:abc', engineDiagnostic: { retained: true } });
  });
});
