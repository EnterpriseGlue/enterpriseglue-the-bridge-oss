import AdmZip from 'adm-zip'
import { posix as pathPosix } from 'node:path'
import type { DeepPartial, EntityManager } from 'typeorm'
import { File } from '@enterpriseglue/shared/db/entities/File.js'
import { Folder } from '@enterpriseglue/shared/db/entities/Folder.js'
import { Version } from '@enterpriseglue/shared/db/entities/Version.js'
import { ensureExt, sanitizeBpmnXml, sanitizeDmnXml } from '@enterpriseglue/shared/services/engines/deployment-utils.js'
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { generateId, unixTimestamp } from '@enterpriseglue/shared/utils/id.js'
import {
  extractBpmnProcessId,
  extractDmnDecisionId,
  remapStarbaseFileReferencesInXml,
} from '@enterpriseglue/shared/utils/starbase-xml.js'

export type ProjectArchiveFileType = 'bpmn' | 'dmn'

export interface ProjectArchiveManifestFolder {
  folderId: string
  path: string
}

export interface ProjectArchiveManifestFile {
  fileId: string
  path: string
  type: ProjectArchiveFileType
  name: string
  bpmnProcessId: string | null
  dmnDecisionId: string | null
}

export interface ProjectArchiveManifest {
  schemaVersion: 1
  projectName: string
  exportedAt: number
  folders: ProjectArchiveManifestFolder[]
  files: ProjectArchiveManifestFile[]
}

interface ParsedArchiveFile {
  manifestFileId: string | null
  path: string
  name: string
  type: ProjectArchiveFileType
  xml: string
}

interface ParsedProjectArchive {
  manifest: ProjectArchiveManifest | null
  files: ParsedArchiveFile[]
  warnings: string[]
}

export interface ApplyProjectArchiveImportInput {
  manager: EntityManager
  projectId: string
  userId: string
  zipBuffer: Buffer
}

export interface ApplyProjectArchiveImportResult {
  foldersCreated: number
  filesCreated: number
  linksRewritten: number
  warnings: string[]
}

type ManifestFolderCandidate = {
  folderId?: unknown
  path?: unknown
}

type ManifestFileCandidate = {
  fileId?: unknown
  path?: unknown
  type?: unknown
  name?: unknown
  bpmnProcessId?: unknown
  dmnDecisionId?: unknown
}

const PROJECT_ARCHIVE_MANIFEST_PATHS = ['starbase-manifest.json', '.starbase/manifest.json'] as const

function normalizeArchivePath(input: string): string {
  const normalized = String(input || '')
    .replace(/\\+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')

  const parts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.some((part) => part === '.' || part === '..')) {
    throw Errors.validation('ZIP archive contains an invalid path')
  }

  return parts.join('/')
}

function getArchiveFileType(filePath: string): ProjectArchiveFileType | null {
  const lower = String(filePath || '').toLowerCase()
  if (lower.endsWith('.bpmn')) return 'bpmn'
  if (lower.endsWith('.dmn')) return 'dmn'
  return null
}

function readManifest(raw: string): ProjectArchiveManifest | null {
  if (!raw.trim()) return null

  const parsed = JSON.parse(raw) as {
    schemaVersion?: unknown
    projectName?: unknown
    exportedAt?: unknown
    folders?: ManifestFolderCandidate[]
    files?: ManifestFileCandidate[]
  }
  if (!parsed || Number(parsed.schemaVersion) !== 1 || !Array.isArray(parsed.files)) return null

  return {
    schemaVersion: 1,
    projectName: String(parsed.projectName || 'project'),
    exportedAt: Number(parsed.exportedAt || 0),
    folders: Array.isArray(parsed.folders)
      ? parsed.folders
          .map((folder: ManifestFolderCandidate) => ({
            folderId: String(folder?.folderId || ''),
            path: normalizeArchivePath(String(folder?.path || '')),
          }))
          .filter((folder: ProjectArchiveManifestFolder) => folder.folderId && folder.path)
      : [],
    files: parsed.files
      .map((file: ManifestFileCandidate) => ({
        fileId: String(file?.fileId || ''),
        path: normalizeArchivePath(String(file?.path || '')),
        type: getArchiveFileType(String(file?.path || '')) || (String(file?.type || '').toLowerCase() === 'dmn' ? 'dmn' : 'bpmn'),
        name: String(file?.name || ''),
        bpmnProcessId: file?.bpmnProcessId ? String(file.bpmnProcessId) : null,
        dmnDecisionId: file?.dmnDecisionId ? String(file.dmnDecisionId) : null,
      }))
      .filter((file: ProjectArchiveManifestFile) => file.fileId && file.path),
  }
}

export function parseProjectArchive(zipBuffer: Buffer): ParsedProjectArchive {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    throw Errors.validation('ZIP archive is required')
  }

  let zip: any
  try {
    zip = new AdmZip(zipBuffer)
  } catch {
    throw Errors.validation('Invalid ZIP archive')
  }

  const warnings: string[] = []
  let manifest: ProjectArchiveManifest | null = null

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const entryPath = normalizeArchivePath(entry.entryName)
    if (!PROJECT_ARCHIVE_MANIFEST_PATHS.includes(entryPath as (typeof PROJECT_ARCHIVE_MANIFEST_PATHS)[number])) continue
    try {
      const parsedManifest = readManifest(entry.getData().toString('utf8'))
      if (parsedManifest) {
        manifest = parsedManifest
        break
      }
      warnings.push('Project archive manifest is invalid and was ignored.')
    } catch {
      warnings.push('Project archive manifest could not be parsed and was ignored.')
    }
  }

  const manifestFilesByPath = new Map<string, ProjectArchiveManifestFile>()
  for (const file of manifest?.files || []) {
    manifestFilesByPath.set(file.path, file)
  }

  const files: ParsedArchiveFile[] = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const entryPath = normalizeArchivePath(entry.entryName)
    if (PROJECT_ARCHIVE_MANIFEST_PATHS.includes(entryPath as (typeof PROJECT_ARCHIVE_MANIFEST_PATHS)[number])) continue

    const type = getArchiveFileType(entryPath)
    if (!type) continue

    const name = pathPosix.basename(entryPath)
    const xml = entry.getData().toString('utf8')
    const manifestFile = manifestFilesByPath.get(entryPath)

    files.push({
      manifestFileId: manifestFile?.fileId || null,
      path: entryPath,
      name,
      type,
      xml,
    })
  }

  if (files.length === 0) {
    throw Errors.validation('ZIP archive does not contain any BPMN or DMN files')
  }

  return { manifest, files, warnings }
}

function getFolderPath(filePath: string): string {
  const dir = pathPosix.dirname(filePath)
  return dir === '.' ? '' : dir
}

function buildFolderPathKey(folderPath: string): string {
  return normalizeArchivePath(folderPath).toLowerCase()
}

async function readExistingFolders(manager: EntityManager, projectId: string) {
  const folderRepo = manager.getRepository(Folder)
  const rows = await folderRepo.find({
    where: { projectId },
    select: ['id', 'name', 'parentFolderId'],
  })

  const byId = new Map<string, { id: string; name: string; parentFolderId: string | null }>()
  rows.forEach((row) => {
    byId.set(String(row.id), {
      id: String(row.id),
      name: String(row.name),
      parentFolderId: row.parentFolderId ? String(row.parentFolderId) : null,
    })
  })

  const cache = new Map<string, string>()
  const resolvePath = (folderId: string | null): string => {
    if (!folderId) return ''
    if (cache.has(folderId)) return cache.get(folderId) as string
    const row = byId.get(folderId)
    if (!row) return ''
    const parentPath = resolvePath(row.parentFolderId)
    const path = parentPath ? `${parentPath}/${row.name}` : row.name
    cache.set(folderId, path)
    return path
  }

  const pathToId = new Map<string, string>()
  rows.forEach((row) => {
    const path = resolvePath(String(row.id))
    if (path) pathToId.set(buildFolderPathKey(path), String(row.id))
  })

  return pathToId
}

async function readExistingFilePaths(manager: EntityManager, projectId: string, folderPathToId: Map<string, string>) {
  const fileRepo = manager.getRepository(File)
  const folderIdToPath = new Map<string, string>()
  folderPathToId.forEach((id, pathKey) => {
    folderIdToPath.set(id, pathKey)
  })

  const rows = await fileRepo.find({
    where: { projectId },
    select: ['id', 'folderId', 'name', 'type'],
  })

  const paths = new Set<string>()
  for (const row of rows) {
    const fileType: ProjectArchiveFileType = String(row.type || '').toLowerCase() === 'dmn' ? 'dmn' : 'bpmn'
    const fileName = ensureExt(String(row.name || ''), fileType)
    const folderPath = row.folderId ? folderIdToPath.get(String(row.folderId)) || '' : ''
    const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName
    paths.add(fullPath.toLowerCase())
  }

  return paths
}

export async function applyProjectArchiveToProject({
  manager,
  projectId,
  userId,
  zipBuffer,
}: ApplyProjectArchiveImportInput): Promise<ApplyProjectArchiveImportResult> {
  const parsed = parseProjectArchive(zipBuffer)
  const now = unixTimestamp()
  const folderRepo = manager.getRepository(Folder)
  const fileRepo = manager.getRepository(File)
  const versionRepo = manager.getRepository(Version)

  const folderPathToId = await readExistingFolders(manager, projectId)
  const existingFilePaths = await readExistingFilePaths(manager, projectId, folderPathToId)

  const archiveFolderPaths = new Map<string, string>()
  for (const folder of parsed.manifest?.folders || []) {
    archiveFolderPaths.set(buildFolderPathKey(folder.path), folder.path)
  }
  for (const file of parsed.files) {
    const folderPath = getFolderPath(file.path)
    if (!folderPath) continue
    const segments = folderPath.split('/')
    for (let index = 0; index < segments.length; index += 1) {
      const currentPath = segments.slice(0, index + 1).join('/')
      archiveFolderPaths.set(buildFolderPathKey(currentPath), currentPath)
    }
  }

  const folderRows: DeepPartial<Folder>[] = []
  for (const folderPath of Array.from(archiveFolderPaths.values()).sort((a, b) => {
    const depthDiff = a.split('/').length - b.split('/').length
    return depthDiff !== 0 ? depthDiff : a.localeCompare(b)
  })) {
    const pathKey = buildFolderPathKey(folderPath)
    if (folderPathToId.has(pathKey)) continue

    const parentPath = getFolderPath(folderPath)
    const parentFolderId = parentPath ? folderPathToId.get(buildFolderPathKey(parentPath)) || null : null
    const folderId = generateId()
    folderPathToId.set(pathKey, folderId)
    folderRows.push({
      id: folderId,
      projectId,
      parentFolderId,
      name: pathPosix.basename(folderPath),
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
  }

  for (const file of parsed.files) {
    if (existingFilePaths.has(file.path.toLowerCase())) {
      throw Errors.conflict(`A file already exists at ${file.path}`)
    }
  }

  if (folderRows.length > 0) {
    await folderRepo.insert(folderRows)
  }

  const manifestFileIdToTarget = new Map<string, { fileId: string; fileName: string }>()
  const preparedFiles = parsed.files.map((file) => {
    const fileId = generateId()
    if (file.manifestFileId) {
      manifestFileIdToTarget.set(file.manifestFileId, { fileId, fileName: file.name })
    }
    return {
      ...file,
      newFileId: fileId,
    }
  })

  let linksRewritten = 0
  const fileRows: DeepPartial<File>[] = []
  const versionRows: DeepPartial<Version>[] = []

  for (const file of preparedFiles) {
    const folderPath = getFolderPath(file.path)
    const folderId = folderPath ? folderPathToId.get(buildFolderPathKey(folderPath)) || null : null
    const sanitizedXml = file.type === 'dmn' ? sanitizeDmnXml(file.xml) : sanitizeBpmnXml(file.xml)
    const relinked = manifestFileIdToTarget.size > 0
      ? remapStarbaseFileReferencesInXml(sanitizedXml, manifestFileIdToTarget)
      : { xml: sanitizedXml, replacements: 0 }

    linksRewritten += Number(relinked.replacements || 0)

    const finalXml = relinked.xml
    const bpmnProcessId = file.type === 'bpmn' ? extractBpmnProcessId(finalXml) : null
    const dmnDecisionId = file.type === 'dmn' ? extractDmnDecisionId(finalXml) : null

    fileRows.push({
      id: file.newFileId,
      projectId,
      folderId,
      name: file.name,
      type: file.type,
      xml: finalXml,
      bpmnProcessId,
      dmnDecisionId,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    versionRows.push({
      id: generateId(),
      fileId: file.newFileId,
      author: 'system',
      message: 'Initial import from project archive',
      xml: finalXml,
      createdAt: now,
    })
  }

  await fileRepo.insert(fileRows)
  await versionRepo.insert(versionRows)

  return {
    foldersCreated: folderRows.length,
    filesCreated: fileRows.length,
    linksRewritten,
    warnings: parsed.warnings,
  }
}
