import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('process-instance incident contracts', () => {
  it('documents the shared incident list for instance incident reads', () => {
    const document = generateOpenApi();

    expect(document.components?.schemas?.MissionControlProcessInstanceIncidentList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/process-instances/{id}/incidents']?.get?.responses?.['200']).toBeDefined();
  });
});
