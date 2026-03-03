import type { EngineRole, ProjectRole } from './roles';

export interface UserSummary {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  roles?: ProjectRole[];
  invitedById?: string | null;
  joinedAt: number;
  user?: UserSummary | null;
}

export interface EngineMember {
  id: string;
  engineId: string;
  userId: string;
  role: EngineRole;
  grantedById?: string | null;
  createdAt: number;
  user?: UserSummary | null;
}
