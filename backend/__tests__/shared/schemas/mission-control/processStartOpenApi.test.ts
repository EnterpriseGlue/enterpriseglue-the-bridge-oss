import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('process-instance start response contract', () => {
  it('documents the compatible engine-native receipt with its guaranteed id', () => {
    const document = generateOpenApi();
    const operation = document.paths?.['/mission-control-api/process-definitions/key/{key}/start']?.post;

    expect(operation?.responses?.['200']).toBeDefined();
    expect(document.components?.schemas?.ProcessInstanceStartResponse?.properties).toMatchObject({
      id: { type: 'string' },
    });
  });
});
