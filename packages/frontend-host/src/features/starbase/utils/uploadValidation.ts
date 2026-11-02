import { QueryClient } from '@tanstack/react-query'
import { CreateFileRequest, CreateFileResponseSchema, FileInsertSchema } from '@enterpriseglue/shared/schemas/starbase/file.js'
import { ProjectArchiveImportResponseSchema } from '@enterpriseglue/shared/schemas/starbase/folder.js'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { getBrowserSessionRevision } from '../../../utils/browserSession'

function parseDiagram(text: string): Document | null {
  // Do not admit entity/DTD declarations or infer XML validity from tag substrings.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) return null
  try {
    const document = new DOMParser().parseFromString(text, 'application/xml')
    return document.getElementsByTagName('parsererror').length ? null : document
  } catch { return null }
}

export function detectCamundaEngine(xml: Document | string) {
  const document = typeof xml === 'string' ? parseDiagram(xml) : xml
  const zeebe = (uri: string | null) => /^https?:\/\/(?:www\.)?camunda\.org\/schema\/zeebe(?:\/|$)/i.test(uri || '')
  const isCamunda8 = !!document && Array.from(document.getElementsByTagName('*')).some(element =>
    zeebe(element.namespaceURI) || Array.from(element.attributes).some(attribute => (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') && zeebe(attribute.value)))
  return { isCamunda7: !isCamunda8, isCamunda8 }
}

type UploadParams = {
  file: File
  projectId: string
  folderId: string | null
  queryClient: QueryClient
  showToast: (t: { kind: 'success' | 'error'; title: string; subtitle?: string }) => void
  assertCurrent?: () => void
  onUncertain?: () => void
}

function currentUpload(params: UploadParams) {
  const browser = getBrowserSessionRevision(), check = params.assertCurrent
  return () => {
    if (browser !== getBrowserSessionRevision()) return false
    try { check?.(); return true } catch { return false }
  }
}

export async function validateAndUploadFile(params: UploadParams): Promise<void> {
  const { file, projectId, folderId, queryClient, showToast, onUncertain } = params
  const current = currentUpload(params), name = file.name
  const fail = (subtitle: string) => { if (current()) showToast({ kind: 'error', title: 'Upload failed', subtitle }) }
  if (!current() || !projectId) return
  if (!FileInsertSchema.shape.projectId.safeParse(projectId).success) { fail('Project upload target was not verified.'); return }
  const extension = name.toLowerCase().endsWith('.bpmn') ? 'bpmn' : name.toLowerCase().endsWith('.dmn') ? 'dmn' : null
  if (!extension) { fail('Only .bpmn and .dmn files are supported.'); return }
  let text: string
  try { text = await file.text() } catch { fail('Could not read file contents.'); return }
  if (!current()) return
  const document = parseDiagram(text)
  if (!document) { fail('File is not valid XML.'); return }
  const root = document.documentElement, namespace = root?.namespaceURI || ''
  const type = namespace === 'http://www.omg.org/spec/BPMN/20100524/MODEL' ? 'bpmn'
    : /^https?:\/\/www\.omg\.org\/spec\/DMN\/(?:20151101\/dmn\.xsd|20180521\/MODEL\/?|20191111\/MODEL\/?|20230324\/MODEL\/?)$/.test(namespace) ? 'dmn' : null
  if (root?.localName !== 'definitions' || !type) { fail('File is not a BPMN or DMN definition.'); return }
  if (type !== extension) { fail('File extension does not match the diagram type.'); return }
  if (detectCamundaEngine(document).isCamunda8) { fail('Camunda 8 / Zeebe diagrams are not supported. Please upload a Camunda 7 BPMN/DMN file.'); return }
  const request = CreateFileRequest.strict().safeParse({ type, name: name.trim(), folderId, xml: text })
  if (!request.success) { fail('File upload request was not verified.'); return }
  let acknowledged = false
  try {
    if (!current()) return
    const raw = await apiClient.post(`/starbase-api/projects/${encodeURIComponent(projectId)}/files`, request.data)
    if (!current()) return
    const receipt = CreateFileResponseSchema.strict().safeParse(raw)
    if (!receipt.success || receipt.data.name !== request.data.name || receipt.data.type !== request.data.type) throw new Error('Unverified upload receipt')
    acknowledged = true
    await queryClient.invalidateQueries({ queryKey: ['contents', projectId] }, { throwOnError: true })
    if (!current()) return
    await queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] }, { throwOnError: true })
    if (current()) showToast({ kind: 'success', title: 'File uploaded', subtitle: name })
  } catch (error) {
    if (!current()) return
    if (!acknowledged && parseApiError(error, 'Upload failed').status === 409) { fail('A file with this name already exists in this folder.'); return }
    onUncertain?.()
    fail(acknowledged ? 'File creation was acknowledged, but contents refresh failed. Refresh the project before retrying.' : 'Upload result was not verified. Refresh project contents before retrying.')
  }
}

export async function validateAndUploadProjectArchive(params: UploadParams): Promise<void> {
  const { file, projectId, queryClient, showToast, onUncertain } = params
  const current = currentUpload(params), name = file.name
  const fail = (subtitle: string) => { if (current()) showToast({ kind: 'error', title: 'Upload failed', subtitle }) }
  if (!current() || !FileInsertSchema.shape.projectId.safeParse(projectId).success) return
  let buffer: ArrayBuffer
  try { buffer = (await file.arrayBuffer()).slice(0) } catch { fail('Could not read archive contents.'); return }
  if (!current()) return
  if (!buffer.byteLength || buffer.byteLength > 25 * 1024 * 1024) { fail('Project archive must contain at most 25 MiB.'); return }
  let acknowledged = false
  try {
    const raw = await apiClient.postRaw(`/starbase-api/projects/${encodeURIComponent(projectId)}/import-zip`, buffer, { headers: { 'Content-Type': 'application/zip' } })
    if (!current()) return
    if (!ProjectArchiveImportResponseSchema.safeParse(raw).success) throw new Error('Unverified archive receipt')
    acknowledged = true
    await queryClient.invalidateQueries({ queryKey: ['contents', projectId] }, { throwOnError: true })
    if (!current()) return
    await queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] }, { throwOnError: true })
    if (current()) showToast({ kind: 'success', title: 'Project zip uploaded', subtitle: `${name} · imported at project root` })
  } catch {
    if (!current()) return
    onUncertain?.()
    fail(acknowledged ? 'Archive import was acknowledged, but contents refresh failed. Refresh the project before retrying.' : 'Archive import result was not verified. Refresh project contents before retrying.')
  }
}
