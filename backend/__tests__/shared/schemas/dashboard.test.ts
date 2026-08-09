import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  DashboardContextSchema,
  DashboardStatsSchema,
} from '@enterpriseglue/shared/schemas/dashboard.js';

describe('dashboard transport contracts', () => {
  it('keeps evaluator-backed dashboard data typed', () => {
    expect(DashboardStatsSchema.parse({
      totalProjects: 1,
      totalFiles: 2,
      fileTypes: { bpmn: 1, dmn: 1, form: 0 },
    })).toMatchObject({ totalProjects: 1 });
    expect(DashboardContextSchema.parse({
      isPlatformAdmin: false,
      ownedEngineIds: [], delegatedEngineIds: [], accessibleEngineIds: ['engine-1'], runtimeScopedEngineIds: [],
      projectMemberships: [{ projectId: 'project-1', projectName: 'Example', role: 'permission' }],
      canViewActiveUsers: false, canViewAllProjects: false, canViewEngines: true,
      canViewProcessData: true, canViewDeployments: true, canViewMetrics: true,
    })).toMatchObject({ accessibleEngineIds: ['engine-1'] });
  });

  it('documents dashboard responses with the shared schemas', () => {
    const document = generateOpenApi();
    expect(document.components?.schemas?.DashboardContext).toBeDefined();
    expect(document.components?.schemas?.DashboardStats).toBeDefined();
    expect(document.paths?.['/api/dashboard/context']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/api/dashboard/stats']?.get?.responses?.['200']).toBeDefined();
  });
});
