import { apiClient } from '../../shared/api/client';
import type {
  CreateFolder,
  CreateFolderResponse,
  FolderDeletePreview,
  FolderSummary,
  UpdateFolder,
  UpdateFolderResponse,
} from '@enterpriseglue/shared/schemas/starbase/folder.js';

const BASE_URL = '/starbase-api';

export const foldersApi = {
  listByProject: (projectId: string) =>
    apiClient.get<FolderSummary[]>(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/folders`),

  create: (projectId: string, data: CreateFolder) =>
    apiClient.post<CreateFolderResponse>(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/folders`, data),

  update: (folderId: string, data: UpdateFolder) =>
    apiClient.patch<UpdateFolderResponse>(`${BASE_URL}/folders/${encodeURIComponent(folderId)}`, data),

  getDeletePreview: (folderId: string) =>
    apiClient.get<FolderDeletePreview>(`${BASE_URL}/folders/${encodeURIComponent(folderId)}/delete-preview`),

  delete: (folderId: string) =>
    apiClient.delete(`${BASE_URL}/folders/${encodeURIComponent(folderId)}`),
};
