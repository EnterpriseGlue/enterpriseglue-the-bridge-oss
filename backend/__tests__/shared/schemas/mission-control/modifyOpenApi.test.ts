import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('process-definition async modification contracts', () => {
  it('documents the exact modification and restart batch receipts', () => {
    const document = generateOpenApi();
    const paths = document.paths;
    const schemas = document.components?.schemas;

    expect(schemas?.ProcessDefinitionModificationAsyncResponse?.properties).toMatchObject({
      id: { type: 'string' },
      camundaBatchId: { type: 'string' },
      type: { type: 'string', enum: ['MODIFY_INSTANCES'] },
    });
    expect(schemas?.ProcessDefinitionRestartAsyncResponse?.properties).toMatchObject({
      id: { type: 'string' },
      camundaBatchId: { type: 'string' },
      type: { type: 'string', enum: ['RESTART_INSTANCES'] },
    });
    expect(paths?.['/mission-control-api/process-definitions/{id}/modification/execute-async']?.post?.responses?.['201']).toBeDefined();
    expect(paths?.['/mission-control-api/process-definitions/{id}/restart/execute-async']?.post?.responses?.['201']).toBeDefined();
  });
});
