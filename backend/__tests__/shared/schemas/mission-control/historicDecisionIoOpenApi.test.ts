import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('historic decision IO contracts', () => {
  it('documents shared decision instance and IO lists for historic decision reads', () => {
    const document = generateOpenApi();
    expect(document.components?.schemas?.HistoricDecisionInstanceList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/history/decisions']?.get?.responses?.['200']).toBeDefined();
    expect(document.components?.schemas?.HistoricDecisionIoList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/history/decisions/{id}/inputs']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/mission-control-api/history/decisions/{id}/outputs']?.get?.responses?.['200']).toBeDefined();
  });
});
