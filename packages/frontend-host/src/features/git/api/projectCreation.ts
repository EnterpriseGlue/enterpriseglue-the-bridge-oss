import {
  CreateProjectRequest, CreateProjectResponseSchema, ProjectImportPreviewResponseSchema,
} from '@enterpriseglue/shared/schemas/starbase/project.js';
import { CreateOnlineProjectRequestSchema, CreateOnlineProjectResponseSchema } from '@enterpriseglue/shared/schemas/git/online-project.js';
import { CloneFromGitRequestSchema, CloneFromGitResponseSchema, GitProviderIdParamsSchema, ProjectGitConnectionRequestSchema, RepositoryInsertSchema } from '@enterpriseglue/shared/schemas/git/repository.js';
import { apiClient } from '../../../shared/api/client';

const onlineRequest = CreateOnlineProjectRequestSchema.omit({ token: true }).extend({
  projectName: CreateProjectRequest.shape.name,
  providerId: GitProviderIdParamsSchema.shape.providerId,
  repositoryName: ProjectGitConnectionRequestSchema.shape.repositoryName,
  namespace: ProjectGitConnectionRequestSchema.shape.namespace,
  importFromEngine: CreateProjectRequest.shape.importFromEngine,
}).strict();
const cloneRequest = CloneFromGitRequestSchema.extend({
  projectName: CreateProjectRequest.shape.name,
  providerId: GitProviderIdParamsSchema.shape.providerId,
  repoUrl: RepositoryInsertSchema.shape.remoteUrl,
}).strict();
const onlineReceipt = CreateOnlineProjectResponseSchema.extend({
  project: CreateOnlineProjectResponseSchema.shape.project.strict(),
  repository: CreateOnlineProjectResponseSchema.shape.repository.strict(),
}).strict();
const previewReceipt = ProjectImportPreviewResponseSchema.extend({
  counts: ProjectImportPreviewResponseSchema.shape.counts.strict(),
  files: ProjectImportPreviewResponseSchema.shape.files.element.strict().array(),
}).strict();
const safeId = (id: string) => /^[a-zA-Z0-9_-]+$/.test(id);

export function prepareProjectCreation(kind: 'local' | 'online' | 'clone', raw: unknown) {
  if (kind === 'local') {
    const parsed = CreateProjectRequest.strict().safeParse(raw);
    if (!parsed.success) throw new Error('Project creation request was not verified');
    return { kind, request: parsed.data } as const;
  }
  if (kind === 'online') {
    const parsed = onlineRequest.safeParse(raw);
    if (!parsed.success) throw new Error('Project creation request was not verified');
    return { kind, request: parsed.data } as const;
  }
  if (kind === 'clone') {
    const parsed = cloneRequest.safeParse(raw);
    if (!parsed.success) throw new Error('Project creation request was not verified');
    const url = new URL(parsed.data.repoUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Repository URL was not verified');
    return { kind, request: parsed.data } as const;
  }
  throw new Error('Project creation mode was not verified');
}
export type ProjectCreationPlan = ReturnType<typeof prepareProjectCreation>;

export async function executeProjectCreation(plan: ProjectCreationPlan, ownerId: string, check: () => void) {
  // Own nested import/request bytes before transport; no endpoint or token override.
  const captured = prepareProjectCreation(plan.kind, plan.request);
  if (!ownerId) throw new Error('Project owner was not verified');
  check();
  if (captured.kind === 'local') {
    const raw = await apiClient.post('/starbase-api/projects', captured.request); check();
    const result = CreateProjectResponseSchema.strict().safeParse(raw);
    if (!result.success || !safeId(result.data.id) || result.data.ownerId !== ownerId || result.data.name !== captured.request.name.trim()) throw new Error('Project creation response was not verified');
    return { id: result.data.id, name: result.data.name };
  }
  if (captured.kind === 'online') {
    const raw = await apiClient.post('/git-api/create-online', captured.request); check();
    const result = onlineReceipt.safeParse(raw);
    if (!result.success || !safeId(result.data.project.id) || !safeId(result.data.repository.id)
      || result.data.project.name !== captured.request.projectName.trim()
      || result.data.repository.name !== captured.request.repositoryName.trim()
      || result.data.repository.private !== (captured.request.isPrivate ?? true)
      || (captured.request.namespace && result.data.repository.fullName !== `${captured.request.namespace}/${captured.request.repositoryName}`)) throw new Error('Project creation response was not verified');
    return result.data.project;
  }
  const raw = await apiClient.post('/git-api/clone', captured.request); check();
  const result = CloneFromGitResponseSchema.safeParse(raw);
  if (!result.success || !safeId(result.data.projectId) || !safeId(result.data.repositoryId) || result.data.projectName !== captured.request.projectName.trim()) throw new Error('Project creation response was not verified');
  return { id: result.data.projectId, name: result.data.projectName };
}

export function verifyProjectImportPreview(raw: unknown, engineId: string) {
  const result = previewReceipt.safeParse(raw);
  if (!result.success || result.data.engineId !== engineId
    || result.data.files.filter(file => file.type === 'bpmn').length !== result.data.counts.bpmn
    || result.data.files.filter(file => file.type === 'dmn').length !== result.data.counts.dmn) throw new Error('Engine import preview was not verified');
  return result.data;
}
