import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('direct-operation transport contracts', () => {
  it('keeps the per-instance result bounded and distinguishes failures from successful ids', async () => {
    const { DirectOperationResultSchema } = await import('@enterpriseglue/shared/schemas/mission-control/direct.js');
    expect(DirectOperationResultSchema.parse({
      total: 2,
      succeeded: ['instance-1'],
      failed: [{ id: 'instance-2', ok: false, error: 'already ended' }],
    })).toEqual({
      total: 2,
      succeeded: ['instance-1'],
      failed: [{ id: 'instance-2', ok: false, error: 'already ended' }],
    });
    expect(() => DirectOperationResultSchema.parse({
      total: 1,
      succeeded: [],
      failed: [{ id: 'instance-1', ok: true }],
    })).toThrow();
  });

  it('documents direct mutation inputs and the shared result for every direct endpoint', () => {
    const document = generateOpenApi();
    const paths = document.paths;
    const schemas = document.components?.schemas;

    expect(schemas?.DirectOperationResult?.properties).toMatchObject({
      total: { type: 'integer', minimum: 0 },
      succeeded: { type: 'array', items: { type: 'string' } },
      failed: { type: 'array' },
    });
    expect(schemas?.DirectProcessInstanceDeleteRequest?.properties).toMatchObject({
      engineId: { type: 'string' },
      processInstanceIds: { type: 'array', items: { type: 'string' } },
      deleteReason: { type: 'string' },
    });
    for (const path of [
      '/mission-control-api/direct/process-instances/delete',
      '/mission-control-api/direct/process-instances/suspend',
      '/mission-control-api/direct/process-instances/activate',
      '/mission-control-api/direct/jobs/retries',
    ]) {
      expect(paths?.[path]?.post?.responses?.['200']).toBeDefined();
    }
  });
});
