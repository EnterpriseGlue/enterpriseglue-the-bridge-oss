import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
const { ProjectArchiveImportResponseSchema } = await import('@enterpriseglue/shared/schemas/starbase/folder.js');
describe('project archive import receipt contract', () => {
  it('publishes the same exact counts/metadata receipt used by browser and route', () => {
    const schema = generateOpenApi().paths?.['/starbase-api/projects/{projectId}/import-zip']?.post?.responses?.['201']?.content?.['application/json']?.schema;
    expect(schema?.required).toEqual(expect.arrayContaining(['foldersCreated', 'filesCreated', 'linksRewritten', 'warnings']));
    expect(schema?.additionalProperties).toBe(false);
    for (const field of ['foldersCreated', 'filesCreated', 'linksRewritten']) expect(schema?.properties?.[field]).toMatchObject({ type: 'integer', minimum: 0 });
    expect(ProjectArchiveImportResponseSchema.parse({ foldersCreated: 0, filesCreated: 1, linksRewritten: 0, warnings: [] })).toMatchObject({ filesCreated: 1 });
  });
});
