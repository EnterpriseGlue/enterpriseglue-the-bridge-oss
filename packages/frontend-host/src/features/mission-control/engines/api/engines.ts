import { apiClient } from '../../../../shared/api/client'

// Types
export type Engine = {
  id: string
  name: string
  baseUrl: string
  tenantId?: string
  createdAt: string
  updatedAt: string
  status?: 'online' | 'offline' | 'unknown'
  version?: string
}

export type EngineHealth = {
  status: 'UP' | 'DOWN' | 'UNKNOWN'
  version?: string
  deployedProcessDefinitions?: number
  activeProcessInstances?: number
}

export type EngineMember = {
  id: string
  engineId: string
  userId: string
  role: 'owner' | 'delegate' | 'operator' | 'deployer'
  grantedById?: string
  grantedAt?: string
  user?: {
    id: string
    email: string
    name?: string
  }
}

// API Functions
export async function getEngines(): Promise<Engine[]> {
  return apiClient.get<Engine[]>('/api/engines', undefined, { credentials: 'include' })
}

export async function getEngine(engineId: string): Promise<Engine> {
  return apiClient.get<Engine>(`/api/engines/${engineId}`, undefined, { credentials: 'include' })
}

export async function createEngine(engine: Omit<Engine, 'id' | 'createdAt' | 'updatedAt'>): Promise<Engine> {
  return apiClient.post<Engine>('/api/engines', engine, { credentials: 'include' })
}

export async function updateEngine(engineId: string, engine: Partial<Engine>): Promise<Engine> {
  return apiClient.put<Engine>(`/api/engines/${engineId}`, engine, { credentials: 'include' })
}

export async function deleteEngine(engineId: string): Promise<void> {
  return apiClient.delete(`/api/engines/${engineId}`, { credentials: 'include' })
}

export async function getEngineHealth(engineId: string): Promise<EngineHealth> {
  return apiClient.get<EngineHealth>(`/api/engines/${engineId}/health`, undefined, { credentials: 'include' })
}

export async function testEngineConnection(baseUrl: string): Promise<{ success: boolean; message?: string }> {
  return apiClient.post<{ success: boolean; message?: string }>('/api/engines/test-connection', { baseUrl }, { credentials: 'include' })
}

// Engine Members
export async function getEngineMembers(engineId: string): Promise<EngineMember[]> {
  return apiClient.get<EngineMember[]>(`/api/engines/${engineId}/members`, undefined, { credentials: 'include' })
}

export async function addEngineMember(engineId: string, userId: string, role: EngineMember['role']): Promise<EngineMember> {
  return apiClient.post<EngineMember>(`/api/engines/${engineId}/members`, { userId, role }, { credentials: 'include' })
}

export async function updateEngineMemberRole(engineId: string, memberId: string, role: EngineMember['role']): Promise<EngineMember> {
  return apiClient.put<EngineMember>(`/api/engines/${engineId}/members/${memberId}`, { role }, { credentials: 'include' })
}

export async function removeEngineMember(engineId: string, memberId: string): Promise<void> {
  return apiClient.delete(`/api/engines/${engineId}/members/${memberId}`, { credentials: 'include' })
}
