import { apiClient } from '../../shared/api/client';
import {
  CreateFolderRequest, CreateFolderResponseSchema, UpdateFolderRequest, UpdateFolderResponseSchema,
  FolderDeletePreviewSchema, FolderListResponseSchema,
  type CreateFolder, type UpdateFolder,
} from '@enterpriseglue/shared/schemas/starbase/folder.js';
const BASE_URL = '/starbase-api';
const idSchema = CreateFolderResponseSchema.shape.id;
const noChange = () => {};
function id(value: string) { if (!idSchema.safeParse(value).success) throw new Error('Folder request target was not verified'); return encodeURIComponent(value); }
export const foldersApi = {
  async listByProject(projectId: string) {
    const raw = await apiClient.get(`${BASE_URL}/projects/${id(projectId)}/folders`);
    const rows = FolderListResponseSchema.safeParse(raw);
    if (!rows.success) throw new Error('Folder tree response was not verified');
    return rows.data;
  },
  async create(projectId: string, data: CreateFolder, check = noChange) {
    const request = CreateFolderRequest.safeParse({ ...data });
    if (!request.success) throw new Error('Folder creation request was not verified');
    const endpoint = `${BASE_URL}/projects/${id(projectId)}/folders`; check();
    const raw = await apiClient.post(endpoint, request.data); check();
    const receipt = CreateFolderResponseSchema.strict().safeParse(raw);
    if (!receipt.success || receipt.data.name !== request.data.name || receipt.data.parentFolderId !== (request.data.parentFolderId ?? null)) throw new Error('Folder creation response was not verified');
    return receipt.data;
  },
  async update(folderId: string, data: UpdateFolder, check = noChange) {
    const request = UpdateFolderRequest.safeParse({ ...data });
    if (!request.success) throw new Error('Folder update request was not verified');
    const endpoint = `${BASE_URL}/folders/${id(folderId)}`; check();
    const raw = await apiClient.patch(endpoint, request.data); check();
    const receipt = UpdateFolderResponseSchema.strict().safeParse(raw);
    if (!receipt.success || receipt.data.id !== folderId || (request.data.name !== undefined && receipt.data.name !== request.data.name)
      || (request.data.parentFolderId !== undefined && receipt.data.parentFolderId !== request.data.parentFolderId)) throw new Error('Folder update response was not verified');
    return receipt.data;
  },
  async getDeletePreview(folderId: string, check = noChange) {
    const endpoint = `${BASE_URL}/folders/${id(folderId)}/delete-preview`; check();
    const raw = await apiClient.get(endpoint); check();
    const preview = FolderDeletePreviewSchema.safeParse(raw);
    if (!preview.success) throw new Error('Folder deletion preview was not verified');
    return preview.data;
  },
  async delete(folderId: string, check = noChange) {
    const endpoint = `${BASE_URL}/folders/${id(folderId)}`; check();
    const raw = await apiClient.delete(endpoint); check();
    if (raw !== undefined) throw new Error('Folder deletion response was not verified');
  },
};
