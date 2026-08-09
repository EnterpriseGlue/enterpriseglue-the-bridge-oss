import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('message-correlation response contract', () => {
  it('documents the engine-compatible result array', () => {
    const document = generateOpenApi();
    const operation = document.paths?.['/mission-control-api/messages']?.post;

    expect(operation?.responses?.['200']).toBeDefined();
    expect(document.components?.schemas?.MessageCorrelationResults).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          resultType: { type: 'string', enum: ['Execution', 'ProcessDefinition'] },
        },
      },
    });
  });
});
