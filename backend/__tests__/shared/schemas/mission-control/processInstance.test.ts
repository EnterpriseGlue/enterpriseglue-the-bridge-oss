import { describe, expect, it } from 'vitest';
import { ProcessInstanceSchema } from '@enterpriseglue/shared/schemas/mission-control/process.js';

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
});
