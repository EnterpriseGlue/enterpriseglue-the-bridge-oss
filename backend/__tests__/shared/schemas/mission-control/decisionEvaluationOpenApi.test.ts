import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('decision-evaluation response contract', () => {
  it('uses the shared variable-envelope result for id and key evaluation routes', () => {
    const document = generateOpenApi();
    const paths = document.paths;

    for (const path of [
      '/mission-control-api/decision-definitions/{id}/evaluate',
      '/mission-control-api/decision-definitions/key/{key}/evaluate',
    ]) {
      expect(paths?.[path]?.post?.responses?.['200']).toBeDefined();
    }
    expect(document.components?.schemas?.DecisionEvaluationResult).toMatchObject({ type: 'array' });
  });
});
