/**
 * Centralized React Query key factories
 * Use these to ensure consistent cache keys across the application
 */

export const queryKeys = {
  // Starbase
  starbase: {
    all: ['starbase'] as const,
    projects: () => ['starbase', 'projects'] as const,
    project: (projectId: string) => ['starbase', 'project', projectId] as const,
    contents: (projectId: string, folderId: string | null) => ['contents', projectId, folderId] as const,
    file: (fileId: string) => ['file', fileId] as const,
    fileBreadcrumb: (fileId: string) => ['file-breadcrumb', fileId] as const,
    files: (projectId: string) => ['files', projectId] as const,
    versions: (fileId: string) => ['versions', fileId] as const,
    comments: (fileId: string) => ['comments', fileId] as const,
    projectMembers: (projectId: string) => ['project-members', projectId] as const,
    uncommittedFiles: (projectId: string, branch: string) => ['uncommitted-files', projectId, branch] as const,
  },

  // Git
  git: {
    all: ['git'] as const,
    credentials: () => ['git', 'credentials'] as const,
    providers: () => ['git', 'providers'] as const,
    repositories: () => ['git', 'repositories'] as const,
    repository: (projectId: string) => ['git', 'repository', projectId] as const,
    deployments: (projectId: string) => ['git', 'deployments', projectId] as const,
    deploymentsRecent: () => ['git', 'deployments', 'recent'] as const,
    commits: (projectId: string, limit?: number) => ['git', 'commits', projectId, limit] as const,
  },

  // Mission Control
  missionControl: {
    all: ['mission-control'] as const,
    processes: (engineId?: string, params?: Record<string, any>) => ['processes', engineId, params] as const,
    processDefinitions: (engineId?: string) => ['process-definitions', engineId] as const,
    instance: (instanceId: string) => ['instance', instanceId] as const,
    instanceActivities: (instanceId: string) => ['instance-activities', instanceId] as const,
    instanceVariables: (instanceId: string) => ['instance-variables', instanceId] as const,
    instanceIncidents: (instanceId: string) => ['instance-incidents', instanceId] as const,
    decisions: (engineId?: string) => ['decisions', engineId] as const,
    decisionInstance: (instanceId: string) => ['decision-instance', instanceId] as const,
    batches: (engineId?: string) => ['batches', engineId] as const,
    batch: (batchId: string) => ['batch', batchId] as const,
  },

  // Engines
  engines: {
    all: ['engines'] as const,
    list: () => ['engines'] as const,
    selector: () => ['engines-selector'] as const,
    members: (engineId: string) => ['engine-members', engineId] as const,
    accessRequests: (engineId: string) => ['engine-access-requests', engineId] as const,
    deployments: (projectId: string) => ['engine-deployments', projectId] as const,
    deploymentsLatest: (projectId: string) => ['engine-deployments', projectId, 'latest'] as const,
  },

  // Users
  users: {
    all: ['users'] as const,
    list: (params?: { limit?: number; offset?: number }) => ['users', params] as const,
    search: (query: string) => ['users', 'search', query] as const,
  },

  // Platform Admin
  admin: {
    settings: () => ['platform-admin', 'admin', 'settings'] as const,
    environments: () => ['platform-admin', 'admin', 'environments'] as const,
    gitProviders: () => ['platform-admin', 'admin', 'git-providers'] as const,
    users: (params?: { limit?: number; offset?: number }) => ['platform-admin', 'admin', 'users', params] as const,
    userSearch: (query: string) => ['platform-admin', 'admin', 'users', 'search', query] as const,
    projectsGovernance: (search?: string) => ['platform-admin', 'admin', 'governance', 'projects', search] as const,
    enginesGovernance: (search?: string) => ['platform-admin', 'admin', 'governance', 'engines', search] as const,
  },

  // Authorization
  authz: {
    ssoMappings: () => ['platform-admin', 'authz', 'sso-mappings'] as const,
    policies: () => ['platform-admin', 'authz', 'policies'] as const,
    auditLog: (params?: Record<string, any>) => ['platform-admin', 'authz', 'audit', params] as const,
  },

  // Email
  email: {
    configs: () => ['email-configs'] as const,
    templates: () => ['email-templates'] as const,
    platformName: () => ['email-platform-name'] as const,
  },

  // Dashboard
  dashboard: {
    context: () => ['dashboard-context'] as const,
    stats: () => ['dashboard-stats'] as const,
    instances: (engineId?: string, timePeriod?: string) => ['dashboard-instances', engineId, timePeriod] as const,
  },
} as const
