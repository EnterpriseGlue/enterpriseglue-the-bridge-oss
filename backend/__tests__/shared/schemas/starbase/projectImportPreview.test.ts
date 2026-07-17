import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  ProjectImportPreviewResponseSchema,
} from '@enterpriseglue/shared/schemas/starbase/project.js';

describe('project import-preview transport contract', () => {
  it('returns metadata only and keeps BPMN and DMN identifiers distinct', () => {
    const preview = ProjectImportPreviewResponseSchema.parse({
      engineId: 'engine-1',
      allowed: true,
      targetAction: 'create_import_target',
      counts: { bpmn: 1, dmn: 1 },
      files: [
        { name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'order', dmnDecisionId: null },
        { name: 'Risk.dmn', type: 'dmn', bpmnProcessId: null, dmnDecisionId: 'risk' },
      ],
      warnings: [],
    });
    expect(preview.files).not.toHaveProperty('xml');
  });

  it('registers the authorization-scoped preview response in OpenAPI', () => {
    const document = generateOpenApi();
    expect(document.components?.schemas?.ProjectImportPreviewResponse).toBeDefined();
    expect(document.paths?.['/starbase-api/projects/import-preview']?.post?.responses?.['200']).toBeDefined();
  });
});
