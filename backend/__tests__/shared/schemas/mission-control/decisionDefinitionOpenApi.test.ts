import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('decision definition contracts', () => {
  it('documents the shared definition list and detail responses', () => {
    const document = generateOpenApi();

    expect(document.components?.schemas?.DecisionDefinitionList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/decision-definitions']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/mission-control-api/decision-definitions/{id}']?.get?.responses?.['200']).toBeDefined();
  });
});
