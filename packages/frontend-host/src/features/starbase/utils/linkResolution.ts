export type ProjectFileMeta = {
  id: string
  name: string
  type: 'bpmn' | 'dmn' | 'form'
  folderId: string | null
  bpmnProcessId?: string | null
  dmnDecisionId?: string | null
  isSelf?: boolean
}

export type ProjectFileIndex = {
  byId: Map<string, ProjectFileMeta>
  byProcessId: Map<string, ProjectFileMeta>
  byDecisionId: Map<string, ProjectFileMeta>
}

export function buildProjectFileIndex(files: ProjectFileMeta[]): ProjectFileIndex {
  const byId = new Map<string, ProjectFileMeta>()
  const byProcessId = new Map<string, ProjectFileMeta>()
  const byDecisionId = new Map<string, ProjectFileMeta>()

  for (const file of files) {
    byId.set(file.id, file)
    if (file.type === 'bpmn' && file.bpmnProcessId) {
      byProcessId.set(file.bpmnProcessId, file)
    }
    if (file.type === 'dmn' && file.dmnDecisionId) {
      byDecisionId.set(file.dmnDecisionId, file)
    }
  }

  return { byId, byProcessId, byDecisionId }
}

export function resolveLinkedFile(
  index: ProjectFileIndex,
  params: { fileId?: string | null; processId?: string | null; decisionId?: string | null }
): ProjectFileMeta | null {
  if (params.fileId && index.byId.has(params.fileId)) return index.byId.get(params.fileId) ?? null
  if (params.processId && index.byProcessId.has(params.processId)) return index.byProcessId.get(params.processId) ?? null
  if (params.decisionId && index.byDecisionId.has(params.decisionId)) return index.byDecisionId.get(params.decisionId) ?? null
  return null
}
