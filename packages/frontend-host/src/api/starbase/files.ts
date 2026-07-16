import { apiClient } from '../../shared/api/client';
import type { File } from '../../shared/api/types';
import type {
  CreateFile,
  CreateFileResponse,
  UpdateFileMetadata,
  UpdateFileMetadataResponse,
} from '@enterpriseglue/shared/schemas/starbase/file.js';

export const filesApi = {
  listByProject: (projectId: string) =>
    apiClient.get<File[]>(`/starbase-api/projects/${projectId}/files`),
  
  getById: (id: string) => apiClient.get<File>(`/starbase-api/files/${id}`),
  
  create: (projectId: string, data: CreateFile) =>
    apiClient.post<CreateFileResponse>(`/starbase-api/projects/${encodeURIComponent(projectId)}/files`, data),
  
  updateXml: (id: string, xml: string, prevUpdatedAt?: number) =>
    apiClient.put<File>(`/starbase-api/files/${id}`, { xml, prevUpdatedAt }),
  
  updateMetadata: (id: string, data: UpdateFileMetadata) =>
    apiClient.patch<UpdateFileMetadataResponse>(`/starbase-api/files/${encodeURIComponent(id)}`, data),

  rename: (id: string, name: string) =>
    filesApi.updateMetadata(id, { name }),
  
  delete: (id: string) => apiClient.delete(`/starbase-api/files/${id}`),
};
