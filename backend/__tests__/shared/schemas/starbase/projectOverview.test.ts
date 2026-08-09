import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import { ProjectOverviewListSchema } from '@enterpriseglue/shared/schemas/starbase/project.js';

describe('Project Overview transport contract', () => {
  it('keeps legacy collaborator labels as display-compatible data', () => {
    const result = ProjectOverviewListSchema.parse([{
      id: 'project-1',
      name: 'Payments',
      createdAt: 1,
      foldersCount: 2,
      filesCount: 3,
      gitUrl: null,
      gitProviderType: null,
      gitSyncStatus: null,
      members: [{
        userId: 'user-1',
        firstName: 'Pat',
        lastName: null,
        role: 'owner',
        diagnosticExtension: 'retained',
      }],
    }]);

    expect(result[0].members?.[0]).toMatchObject({ role: 'owner', diagnosticExtension: 'retained' });
  });

  it('documents the shared Project Overview list response', () => {
    const document = generateOpenApi();

    expect(document.components?.schemas?.ProjectOverviewList).toMatchObject({ type: 'array' });
    expect(document.paths?.['/starbase-api/projects']?.get?.responses?.['200']).toBeDefined();
  });
});
