import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('migration OpenAPI contracts', () => {
  it('documents the primary and compatibility generate endpoints with the shared engine-compatible plan shape', () => {
    const document = generateOpenApi();
    const paths = document.paths;
    const schemas = document.components?.schemas;

    expect(paths?.['/mission-control-api/migration/generate']?.post).toBeDefined();
    expect(paths?.['/mission-control-api/migration/plan/generate']?.post).toBeDefined();
    expect(schemas?.MigrationPlan?.properties).toMatchObject({
      sourceProcessDefinitionId: { type: 'string' },
      targetProcessDefinitionId: { type: 'string' },
    });
    expect(schemas?.MigrationInstruction?.properties?.targetActivityIds).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });
});
