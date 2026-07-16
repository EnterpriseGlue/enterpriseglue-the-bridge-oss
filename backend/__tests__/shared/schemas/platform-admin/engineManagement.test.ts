import { describe, expect, it } from 'vitest';
import {
  EngineProjectAccessRequestResultSchema,
  EngineProjectAccessRequestSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/engine-management.js';

describe('EngineProjectAccessRequestSchema', () => {
  it('preserves the pending request contract without relation or role assumptions', () => {
    const parsed = EngineProjectAccessRequestSchema.parse({
      id: 'request-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      requestedById: 'user-1',
      status: 'pending',
      createdAt: 1710000000,
      requestedRole: 'operator',
      requestedBy: { email: 'uncontracted@example.test' },
    });

    expect(parsed).toEqual({
      id: 'request-1',
      projectId: 'project-1',
      engineId: 'engine-1',
      requestedById: 'user-1',
      status: 'pending',
      createdAt: 1710000000,
    });
  });
});

describe('EngineProjectAccessRequestResultSchema', () => {
  it('preserves the request outcome returned to a project caller', () => {
    expect(EngineProjectAccessRequestResultSchema.parse({
      status: 'pending',
      autoApproved: false,
      requestId: 'request-1',
    })).toMatchObject({ status: 'pending', autoApproved: false });
  });
});
