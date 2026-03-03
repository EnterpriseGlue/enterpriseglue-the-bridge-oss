import { QueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'

export function detectCamundaEngine(xml: Document) {
  const root = xml.documentElement
  const nsAttrs = Array.from(root.attributes).filter(a => a.name === 'xmlns' || a.name.startsWith('xmlns:'))
  const hasZeebeNs = nsAttrs.some(a => a.value.includes('zeebe'))
  const hasZeebeElements = xml.getElementsByTagNameNS('*', 'taskDefinition').length > 0 || xml.getElementsByTagNameNS('*', 'ioMapping').length > 0
  const hasZeebePrefix = !!xml.getElementsByTagName('zeebe:taskDefinition').length || !!xml.getElementsByTagName('zeebe:ioMapping').length
  const isCamunda8 = hasZeebeNs || hasZeebeElements || hasZeebePrefix
  const isCamunda7 = !isCamunda8
  return { isCamunda7, isCamunda8 }
}

export async function validateAndUploadFile(params: {
  file: File
  projectId: string
  folderId: string | null
  queryClient: QueryClient
  showToast: (t: { kind: 'success' | 'error'; title: string; subtitle?: string }) => void
}): Promise<void> {
  const { file, projectId, folderId, queryClient, showToast } = params
  if (!projectId) return

  const name = file.name.toLowerCase()
  if (!name.endsWith('.bpmn') && !name.endsWith('.dmn')) {
    showToast({ kind: 'error', title: 'Upload failed', subtitle: 'Only .bpmn and .dmn files are supported.' })
    return
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    showToast({ kind: 'error', title: 'Upload failed', subtitle: 'Could not read file contents.' })
    return
  }

  let xml: Document
  try {
    const parser = new DOMParser()
    xml = parser.parseFromString(text, 'application/xml')
    const parserError = xml.getElementsByTagName('parsererror')[0]
    if (parserError) throw new Error('Invalid XML')
  } catch {
    showToast({ kind: 'error', title: 'Upload failed', subtitle: 'File is not valid XML.' })
    return
  }

  const rootTag = xml.documentElement.tagName
  const isBpmn = rootTag.toLowerCase().includes('definitions') && (text.includes('spec/BPMN') || text.includes('bpmn:definitions'))
  const isDmn = rootTag.toLowerCase().includes('definitions') && (text.includes('spec/DMN') || text.includes('dmn:definitions'))
  if (!isBpmn && !isDmn) {
    showToast({ kind: 'error', title: 'Upload failed', subtitle: 'File is not a BPMN or DMN definition.' })
    return
  }

  const engine = detectCamundaEngine(xml)
  if (engine.isCamunda8) {
    showToast({ kind: 'error', title: 'Upload failed', subtitle: 'Camunda 8 / Zeebe diagrams are not supported. Please upload a Camunda 7 BPMN/DMN file.' })
    return
  }

  try {
    const payload = {
      type: isDmn ? 'dmn' : 'bpmn',
      name: file.name,
      folderId,
      xml: text,
    }
    try {
      await apiClient.post(`/starbase-api/projects/${encodeURIComponent(projectId)}/files`, payload)
    } catch (error) {
      const parsed = parseApiError(error, 'Upload failed')
      if (parsed.status === 409) {
        showToast({ kind: 'error', title: 'Upload failed', subtitle: 'A file with this name already exists in this folder.' })
        return
      }
      throw error
    }
    queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
    showToast({ kind: 'success', title: 'File uploaded', subtitle: file.name })
  } catch {
    showToast({ kind: 'error', title: 'Upload failed', subtitle: 'Could not upload file. Please try again.' })
  }
}
