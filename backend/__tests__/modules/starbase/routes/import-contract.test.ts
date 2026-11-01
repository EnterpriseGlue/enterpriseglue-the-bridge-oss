import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
const { ProjectArchiveImportResponseSchema, FolderListResponseSchema, FolderDeletePreviewSchema } = await import('@enterpriseglue/shared/schemas/starbase/folder.js');
describe('project archive import receipt contract', () => {
  it('publishes the same exact counts/metadata receipt used by browser and route', () => {
    const schema = generateOpenApi().paths?.['/starbase-api/projects/{projectId}/import-zip']?.post?.responses?.['201']?.content?.['application/json']?.schema;
    expect(schema?.required).toEqual(expect.arrayContaining(['foldersCreated', 'filesCreated', 'linksRewritten', 'warnings']));
    expect(schema?.additionalProperties).toBe(false);
    for (const field of ['foldersCreated', 'filesCreated', 'linksRewritten']) expect(schema?.properties?.[field]).toMatchObject({ type: 'integer', minimum: 0 });
    expect(ProjectArchiveImportResponseSchema.parse({ foldersCreated: 0, filesCreated: 1, linksRewritten: 0, warnings: [] })).toMatchObject({ filesCreated: 1 });
  });
});


describe('folder traversal API contract', () => {
  it('publishes exact folder metadata and consistent deletion preview counts', () => {
    const paths = generateOpenApi().paths!;
    const list = paths['/starbase-api/projects/{projectId}/folders']?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(list).toMatchObject({ type: 'array', items: { additionalProperties: false } });
    expect(list?.items?.properties?.id).toMatchObject({ type: 'string', format: 'uuid' });
    const preview = paths['/starbase-api/folders/{folderId}/delete-preview']?.get?.responses?.['200']?.content?.['application/json']?.schema;
    expect(preview?.additionalProperties).toBe(false);
    expect(preview?.properties?.fileCount).toMatchObject({ type: 'integer', minimum: 0 });
    expect(FolderListResponseSchema.parse([])).toEqual([]);
    expect(FolderDeletePreviewSchema.safeParse({ folderCount: 1, fileCount: 1, filesByType: { bpmn: 0, dmn: 0, other: 0 }, samplePaths: [] }).success).toBe(false);
  });
});
