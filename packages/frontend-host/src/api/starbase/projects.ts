import { apiClient } from '../../shared/api/client';
import type { Project } from '../../shared/api/types';
import type { ProjectEngineAccessResponse } from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js';
import type {
  ProjectMemberAccessView,
  ProjectMemberCapabilities,
  ProjectMemberLookup,
  ProjectMembersResponse,
  ProjectDeployGrantResponse,
  ReissuedManualProjectInvitation,
} from '@enterpriseglue/shared/schemas/platform-admin/project-member.js';

const BASE_URL = '/starbase-api/projects';

export const projectsApi = {
  list: () => apiClient.get<Project[]>(BASE_URL),
  
  getById: (id: string) => apiClient.get<Project>(`${BASE_URL}/${id}`),

  getEngineAccess: (id: string) =>
    apiClient.get<ProjectEngineAccessResponse>(`${BASE_URL}/${encodeURIComponent(id)}/engine-access`),

  getMembers: (id: string) =>
    apiClient.get<ProjectMembersResponse>(`${BASE_URL}/${encodeURIComponent(id)}/members`),

  getMyMembership: (id: string) =>
    apiClient.get<ProjectMemberAccessView>(`${BASE_URL}/${encodeURIComponent(id)}/members/me`),

  getMemberCapabilities: (id: string) =>
    apiClient.get<ProjectMemberCapabilities>(`${BASE_URL}/${encodeURIComponent(id)}/members/capabilities`),

  lookupMember: (id: string, email?: string) =>
    apiClient.get<ProjectMemberLookup>(
      `${BASE_URL}/${encodeURIComponent(id)}/members/lookup`,
      email ? { email } : undefined,
    ),

  updateMemberDeployGrant: (id: string, userId: string, allowed: boolean) =>
    apiClient.put<ProjectDeployGrantResponse>(
      `${BASE_URL}/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/deploy-permission`,
      { allowed },
    ),

  reissueManualMemberInvitation: (id: string, invitationId: string) =>
    apiClient.post<ReissuedManualProjectInvitation>(
      `${BASE_URL}/${encodeURIComponent(id)}/pending-invites/${encodeURIComponent(invitationId)}/reissue`,
      {},
    ),

  removeMember: (id: string, userId: string) =>
    apiClient.delete(`${BASE_URL}/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),

  transferOwnership: (id: string, newOwnerId: string) =>
    apiClient.post(`${BASE_URL}/${encodeURIComponent(id)}/transfer-ownership`, { newOwnerId }),
  
  create: (data: { name: string }) => apiClient.post<Project>(BASE_URL, data),
  
  rename: (id: string, name: string) => 
    apiClient.patch<{ id: string; name: string }>(`${BASE_URL}/${id}`, { name }),
  
  delete: (id: string) => apiClient.delete(`${BASE_URL}/${id}`),
};
