import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { ProcessInstanceStartRequestSchema } from '@enterpriseglue/shared/schemas/mission-control/process.js';

describe('process-instance start response contract', () => {
  it('documents the compatible engine-native receipt with its guaranteed id', () => {
    const document = generateOpenApi();
    const operation = document.paths?.['/mission-control-api/process-definitions/key/{key}/start']?.post;

    expect(operation?.responses?.['200']).toBeDefined();
    expect(document.components?.schemas?.ProcessInstanceStartResponse?.properties).toMatchObject({
      id: { type: 'string' },
    });
  });

  it('documents exact start input, definition-bound receipt and the same start action', () => {
    const document = generateOpenApi();
    const operation = document.paths?.['/mission-control-api/process-definitions/{id}/start']?.post;
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.['x-enterpriseglue-authz']).toMatchObject({ actionId: 'engine.runtime.process-definitions.start' });
    expect(document.components?.schemas?.ProcessInstanceStartRequest?.required).toContain('engineId');
    expect(document.components?.schemas?.ProcessInstanceStartByDefinitionResponse?.required).toEqual(expect.arrayContaining(['id', 'definitionId']));
  });

  it('rejects reserved variable names before a record parser can omit them', () => {
    expect(ProcessInstanceStartRequestSchema.safeParse(JSON.parse('{"engineId":"engine-1","variables":{"__proto__":{"value":"kept"}}}')).success).toBe(false);
    expect(ProcessInstanceStartRequestSchema.parse({ engineId: 'engine-1', variables: { constructor: { value: 1 } } }).variables).toHaveProperty('constructor', { value: 1 });
  });
});
