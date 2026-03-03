import { apiClient } from '../../shared/api/client';
import type { File } from '../../shared/api/types';

export const filesApi = {
  listByProject: (projectId: string) =>
    apiClient.get<File[]>(`/starbase-api/projects/${projectId}/files`),
  
  getById: (id: string) => apiClient.get<File>(`/starbase-api/files/${id}`),
  
  create: (projectId: string, data: { name: string; type?: 'bpmn' | 'dmn' }) =>
    apiClient.post<File>(`/starbase-api/projects/${projectId}/files`, data),
  
  updateXml: (id: string, xml: string, prevUpdatedAt?: number) =>
    apiClient.put<File>(`/starbase-api/files/${id}`, { xml, prevUpdatedAt }),
  
  rename: (id: string, name: string) =>
    apiClient.patch<File>(`/starbase-api/files/${id}`, { name }),
  
  delete: (id: string) => apiClient.delete(`/starbase-api/files/${id}`),
};
