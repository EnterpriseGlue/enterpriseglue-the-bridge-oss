import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  DecisionEditTargetSchema,
  ProcessEditTargetSchema,
} from '@enterpriseglue/shared/schemas/mission-control/edit-target.js';

describe('deployed edit-target transport contracts', () => {
  it('keeps process and decision edit targets aligned with their deployed lineage', () => {
    expect(ProcessEditTargetSchema.parse({
      canShowEditButton: true, canEdit: true, engineId: 'engine-1', projectId: 'project-1', fileId: 'file-1',
      engineDeploymentId: 'deployment-1', commitId: null, fileVersionNumber: 2, mappingSource: 'git-commit',
      artifactCreatedAt: 1, lineageQuality: 'complete', processKey: 'invoice', processVersion: 3,
    })).toMatchObject({ processKey: 'invoice', lineageQuality: 'complete' });
    expect(DecisionEditTargetSchema.parse({
      canShowEditButton: true, canEdit: false, engineId: 'engine-1', projectId: 'project-1', fileId: 'file-1',
      decisionKey: 'credit', decisionVersion: 4,
    })).toMatchObject({ decisionKey: 'credit', canEdit: false });
  });

  it('documents both edit-target routes using shared schemas', () => {
    const document = generateOpenApi();
    expect(document.components?.schemas?.ProcessEditTarget).toBeDefined();
    expect(document.components?.schemas?.DecisionEditTarget).toBeDefined();
    expect(document.paths?.['/mission-control-api/process-definitions/edit-target']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths?.['/mission-control-api/decision-definitions/edit-target']?.get?.responses?.['200']).toBeDefined();
  });
});
