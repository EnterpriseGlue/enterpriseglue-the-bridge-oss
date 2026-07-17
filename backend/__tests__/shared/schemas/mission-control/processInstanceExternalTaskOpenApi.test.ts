import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('process-instance external-task contracts', () => {
  it('documents the shared failed external-task list for instance reads', () => {
    const document = generateOpenApi();

    expect(document.components?.schemas?.MissionControlProcessInstanceExternalTaskList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/mission-control-api/process-instances/{id}/failed-external-tasks']?.get?.responses?.['200']).toBeDefined();
  });
});
