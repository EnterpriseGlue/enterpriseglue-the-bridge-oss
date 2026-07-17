import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('historic collection contracts', () => {
  it('documents shared task and variable lists for every historic collection route', () => {
    const document = generateOpenApi();

    expect(document.components?.schemas?.HistoricTaskInstanceList).toMatchObject({ type: 'array' });
    expect(document.components?.schemas?.HistoricVariableInstanceList).toMatchObject({ type: 'array' });
    expect(document.components?.schemas?.UserOperationLogEntryList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/history/tasks']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/mission-control-api/history/variables']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/mission-control-api/history/variable-instances']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/mission-control-api/history/user-operations']?.get?.responses?.['200']).toBeDefined();
  });
});
