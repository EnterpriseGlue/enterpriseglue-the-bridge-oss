import { apiClient } from '../../shared/api/client';
import type { Project } from '../../shared/api/types';

const BASE_URL = '/starbase-api/projects';

export const projectsApi = {
  list: () => apiClient.get<Project[]>(BASE_URL),
  
  getById: (id: string) => apiClient.get<Project>(`${BASE_URL}/${id}`),
  
  create: (data: { name: string }) => apiClient.post<Project>(BASE_URL, data),
  
  rename: (id: string, name: string) => 
    apiClient.patch<{ id: string; name: string }>(`${BASE_URL}/${id}`, { name }),
  
  delete: (id: string) => apiClient.delete(`${BASE_URL}/${id}`),
};
