import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('batch operation create contracts', () => {
  it('documents the shared receipt for every batch mutation', () => {
    const document = generateOpenApi();
    const paths = document.paths;
    const schema = document.components?.schemas?.BatchOperationCreateResponse;

    expect(schema?.properties).toMatchObject({
      id: { type: 'string' },
      camundaBatchId: { type: 'string' },
      type: {
        type: 'string',
        enum: ['DELETE_INSTANCES', 'SUSPEND_INSTANCES', 'ACTIVATE_INSTANCES', 'SET_JOB_RETRIES'],
      },
    });
    for (const path of [
      '/mission-control-api/batches/process-instances/delete',
      '/mission-control-api/batches/process-instances/suspend',
      '/mission-control-api/batches/process-instances/activate',
      '/mission-control-api/batches/jobs/retries',
    ]) {
      expect(paths?.[path]?.post?.responses?.['201']).toBeDefined();
    }
  });
});
