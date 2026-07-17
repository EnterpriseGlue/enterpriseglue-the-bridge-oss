import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { CreateOnlineProjectResponseSchema } from '@enterpriseglue/shared/schemas/git/online-project.js';

describe('online project creation transport contract', () => {
  it('contains project and repository metadata but no submitted credentials', () => {
    const response = CreateOnlineProjectResponseSchema.parse({
      project: { id: 'project-1', name: 'Payments' },
      repository: {
        id: 'repository-1', name: 'payments', fullName: 'acme/payments',
        url: 'https://example.test/acme/payments', cloneUrl: 'https://example.test/acme/payments.git', private: true,
      },
    });
    expect(response.project.name).toBe('Payments');
    expect(response.repository).not.toHaveProperty('token');
  });

  it('registers the Git-backed project response in OpenAPI', () => {
    const document = generateOpenApi();
    expect(document.components?.schemas?.CreateOnlineProjectResponse).toBeDefined();
    expect(document.paths?.['/git-api/create-online']?.post?.responses?.['201']).toBeDefined();
  });
});
