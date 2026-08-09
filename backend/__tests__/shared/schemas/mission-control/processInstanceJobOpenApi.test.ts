import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('process-instance job contracts', () => {
  it('documents the shared job list for instance job reads', () => {
    const document = generateOpenApi();

    expect(document.components?.schemas?.MissionControlProcessInstanceJobList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/process-instances/{id}/jobs']?.get?.responses?.['200']).toBeDefined();
  });
});
