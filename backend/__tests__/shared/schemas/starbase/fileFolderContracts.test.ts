import { describe, expect, it } from 'vitest';
import {
  CreateFileRequest,
  CreateFileResponseSchema,
  UpdateFileMetadataRequest,
  UpdateFileMetadataResponseSchema,
} from '@enterpriseglue/shared/schemas/starbase/file.js';
import {
  CreateFolderRequest,
  CreateFolderResponseSchema,
  UpdateFolderRequest,
  UpdateFolderResponseSchema,
} from '@enterpriseglue/shared/schemas/starbase/folder.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('Starbase file and folder contracts', () => {
  it('keeps file request validation and route response shape aligned', () => {
    expect(CreateFileRequest.parse({ name: 'Invoice', folderId: id, type: 'bpmn' }))
      .toMatchObject({ name: 'Invoice', folderId: id });
    expect(() => UpdateFileMetadataRequest.parse({ folderId: 'folder-1' })).toThrow();
    expect(UpdateFileMetadataResponseSchema.parse({
      id,
      name: 'Invoice',
      folderId: null,
      updatedAt: 1710000000,
    })).toMatchObject({ folderId: null });
    expect(CreateFileResponseSchema.parse({
      id,
      name: 'Invoice',
      type: 'bpmn',
      bpmnProcessId: 'Process_1',
      dmnDecisionId: null,
      createdAt: 1710000000,
      updatedAt: 1710000000,
    })).toMatchObject({ type: 'bpmn' });
  });

  it('keeps folder request validation and route response shape aligned', () => {
    expect(CreateFolderRequest.parse({ name: 'Finance', parentFolderId: id }))
      .toMatchObject({ parentFolderId: id });
    expect(() => UpdateFolderRequest.parse({ parentFolderId: 'folder-1' })).toThrow();
    expect(CreateFolderResponseSchema.parse({
      id,
      name: 'Finance',
      parentFolderId: null,
      createdAt: 1710000000,
      updatedAt: 1710000000,
    })).toMatchObject({ parentFolderId: null });
    expect(UpdateFolderResponseSchema.parse({
      id,
      name: 'Finance',
      parentFolderId: id,
      updatedAt: 1710000000,
    })).toMatchObject({ parentFolderId: id });
  });
});
