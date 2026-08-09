import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  CreateProjectRequest,
  CreateProjectResponseSchema,
} from '@enterpriseglue/shared/schemas/starbase/project.js';

describe('project creation transport contract', () => {
  it('requires an engine when project creation enables engine import', () => {
    expect(() => CreateProjectRequest.parse({
      name: 'Payments',
      importFromEngine: { enabled: true },
    })).toThrow('Engine selection is required when import is enabled');
    expect(CreateProjectResponseSchema.parse({
      id: 'project-1', name: 'Payments', ownerId: 'user-1', createdAt: 1, updatedAt: 1,
    })).toMatchObject({ id: 'project-1' });
  });

  it('documents the compatible 200 response', () => {
    const document = generateOpenApi();
    expect(document.components?.schemas?.CreateProjectResponse).toBeDefined();
    expect(document.paths?.['/starbase-api/projects']?.post?.responses?.['200']).toBeDefined();
  });
});
