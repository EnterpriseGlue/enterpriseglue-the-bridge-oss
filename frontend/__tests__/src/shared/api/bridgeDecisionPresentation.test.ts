import { describe, expect, it } from 'vitest';
import {
  bridgeEffectiveAccessUrl,
  formatBridgeMissingActions,
} from '@src/shared/api/bridgeDecisionPresentation';
import type { BridgeDecisionResponse } from '@src/shared/api/bridgeAuthz';

function deniedDecision(overrides: Partial<BridgeDecisionResponse> = {}): BridgeDecisionResponse {
  return {
    allowed: false,
    reasonCode: 'missing_project_file_read_permission',
    reason: 'The runtime artifact cannot be opened in Starbase.',
    missingActions: ['project.files.read', 'project.files.read', 'engine.runtime.process-definitions.read'],
    projectId: 'project-1',
    fileId: 'file-1',
    engineId: 'engine-1',
    targetId: 'target-1',
    lineage: {},
    diagnostics: {
      effectiveAccessUrl: '/admin/access-control?tab=effective-access',
      label: 'Effective Access',
    },
    ...overrides,
  };
}

describe('bridge decision presentation', () => {
  it('deduplicates missing backend requirements without changing their order', () => {
    expect(formatBridgeMissingActions(deniedDecision()))
      .toBe('project.files.read, engine.runtime.process-definitions.read');
  });

  it('preserves the backend-provided Effective Access destination', () => {
    expect(bridgeEffectiveAccessUrl(deniedDecision()))
      .toBe('/admin/access-control?tab=effective-access');
  });

  it('does not invent a diagnostic destination when the backend did not return one', () => {
    expect(bridgeEffectiveAccessUrl(deniedDecision({ diagnostics: undefined }))).toBeNull();
  });
});
