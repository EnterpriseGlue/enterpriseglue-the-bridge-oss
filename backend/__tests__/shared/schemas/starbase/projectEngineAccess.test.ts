import { describe, expect, it } from 'vitest';
import { ProjectEngineAccessResponseSchema } from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js';

const response = {
  accessedEngines: [{
    engineId: 'engine-1',
    engineName: 'Orders',
    baseUrl: 'https://engine.example.test',
    deploymentIntegration: 'direct_engine',
    environment: { name: 'Production', color: null },
    deploymentTarget: {
      id: 'target-1',
      status: 'active',
      source: 'config',
      sourceRef: 'targets/orders',
      allowManualDeploy: false,
      allowCiDeploy: true,
      allowApiDeploy: true,
      allowImport: true,
      lastSeenAt: 1710000000,
      createdAt: 1700000000,
      updatedAt: 1710000000,
    },
    manualDeployAllowed: false,
    manualDeployDeniedReasons: ['Manual deployment is disabled for this target'],
    ciDeployAllowed: true,
    deploymentEligibility: {
      diagnosticsVisible: false,
      manual: { allowed: false, reasons: ['Manual deployment is disabled for this target'] },
      ci: { allowed: true, reasons: [] },
    },
    health: { status: 'connected', latencyMs: 42 },
    grantedAt: 1700000000,
    passwordEnc: 'must-not-reach-the-client',
  }],
  pendingRequests: [],
  availableEngines: [{ id: 'engine-2', name: 'Payments' }],
};

describe('ProjectEngineAccessResponseSchema', () => {
  it('preserves evaluated deployment state while stripping non-contract credentials', () => {
    const parsed = ProjectEngineAccessResponseSchema.parse(response);

    expect(parsed.accessedEngines[0]).toMatchObject({
      engineId: 'engine-1',
      environment: { name: 'Production', color: null },
      deploymentEligibility: { ci: { allowed: true } },
    });
    expect(parsed.accessedEngines[0]).not.toHaveProperty('passwordEnc');
  });
});
