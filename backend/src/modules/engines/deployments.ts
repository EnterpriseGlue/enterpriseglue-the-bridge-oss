import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { logger } from '@shared/utils/logger.js';
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { validateBody } from '@shared/middleware/validate.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireDeployPermission } from '@shared/middleware/deployAuth.js'
import { apiLimiter } from '@shared/middleware/rateLimiter.js'
import { getDataSource } from '@shared/db/data-source.js'
import { Engine } from '@shared/db/entities/Engine.js'
import { EngineDeploymentArtifact } from '@shared/db/entities/EngineDeploymentArtifact.js'
import { EngineDeployment } from '@shared/db/entities/EngineDeployment.js'
import { File as FileEntity } from '@shared/db/entities/File.js'
import { Folder } from '@shared/db/entities/Folder.js'
import { GitDeployment } from '@shared/db/entities/GitDeployment.js'
import { In } from 'typeorm'
import { fetch, FormData } from 'undici'
import { Buffer } from 'node:buffer'
import { engineService } from '@shared/services/platform-admin/index.js'
import { vcsService } from '@shared/services/versioning/index.js'
import { generateId } from '@shared/utils/id.js'
import {
  sanitize,
  hashContent,
  sendUpstream,
  ensureExt,
  sanitizeDmnXml,
  sanitizeBpmnXml,
} from '@shared/services/engines/deployment-utils.js'
import type {
  EngineConnectionInfo,
  DeploymentFileResource,
  DeployRequestBody,
  CamundaDeploymentResponse,
  CamundaProcessDefinition,
  CamundaDecisionDefinition,
  CamundaDecisionRequirementsDefinition,
  ResourceMeta,
  DmnDebugMeta,
  FileGitCommitInfo,
} from '../../types/deployment.js'
import { ENGINE_VIEW_ROLES, ENGINE_MANAGE_ROLES } from '@shared/constants/roles.js'

// Validation schemas
const deployResourcesSchema = z.object({
  resources: z.object({
    fileIds: z.array(z.string()).optional(),
    folderId: z.string().optional(),
    projectId: z.string().optional(),
  }).optional(),
  deploymentName: z.string().optional(),
  enableDuplicateFiltering: z.boolean().optional(),
  deployChangedOnly: z.boolean().optional(),
}).passthrough()

// Type for Camunda definition in deployment response
interface CamundaDefinitionItem {
  id?: string;
  key?: string;
  resourceName?: string;
  resource?: string;
  version?: number | string;
  tenantId?: string | null;
}

// Type for deployment response with definitions
interface DeploymentResponseData {
  deployedProcessDefinitions?: Record<string, CamundaDefinitionItem>;
  deployedDecisionDefinitions?: Record<string, CamundaDefinitionItem>;
  deployedDecisionRequirementsDefinitions?: Record<string, CamundaDefinitionItem>;
  [key: string]: unknown;
}

const r = Router()

// Helpers - now imported from deployment-utils.ts

async function getEngineById(engineId: string): Promise<EngineConnectionInfo> {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const row = await engineRepo.findOne({ where: { id: engineId } })
  if (!row) throw Object.assign(new Error('Engine not found'), { status: 404 })
  return { id: row.id, baseUrl: row.baseUrl, username: row.username ?? null, passwordEnc: row.passwordEnc ?? null }
}

function authHeaders(e: { username?: string|null; passwordEnc?: string|null }): Record<string,string> {
  const h: Record<string,string> = {}
  if (e.username) {
    const token = Buffer.from(`${e.username}:${e.passwordEnc ?? ''}`).toString('base64')
    h['Authorization'] = `Basic ${token}`
  }
  return h
}

/**
 * Resolve files from request resources
 * ✨ Migrated to TypeORM
 */
async function resolveFilesFromRequest(req: Request): Promise<DeploymentFileResource[]> {
  const body = (req.body || {}) as DeployRequestBody
  const { resources } = body
  const out: Array<{ id: string; name: string; type: 'bpmn'|'dmn'; xml: string; projectId: string; folderId: string | null; updatedAt: number | null }> = []
  const dataSource = await getDataSource()
  const fileRepo = dataSource.getRepository(FileEntity)
  const folderRepo = dataSource.getRepository(Folder)

  const addFileById = async (fid: string) => {
    const row = await fileRepo.findOne({ where: { id: fid } })
    
    if (row) {
      const ty = String(row.type)
      if (ty === 'bpmn' || ty === 'dmn') {
        out.push({ 
          id: String(row.id), 
          projectId: String(row.projectId), 
          folderId: row.folderId ? String(row.folderId) : null, 
          name: String(row.name), 
          type: ty as 'bpmn'|'dmn', 
          xml: ty === 'dmn' ? sanitizeDmnXml(String(row.xml || '')) : sanitizeBpmnXml(String(row.xml || '')),
          updatedAt: row.updatedAt !== null && typeof row.updatedAt !== 'undefined' ? Number(row.updatedAt) : null,
        })
      }
    }
  }

  const collectFolder = async (fid: string, recursive: boolean) => {
    // Collect files in this folder
    const filesResult = await fileRepo.find({ where: { folderId: fid }, select: ['id'] })
    
    for (const row of filesResult) {
      await addFileById(String(row.id))
    }
    
    if (!recursive) return
    
    const foldersResult = await folderRepo.find({ where: { parentFolderId: fid }, select: ['id'] })
    
    for (const row of foldersResult) {
      await collectFolder(String(row.id), true)
    }
  }

  if (resources?.fileIds) {
    for (const fid of resources.fileIds) await addFileById(String(fid))
  } else if (resources?.folderId) {
    await collectFolder(String(resources.folderId), !!resources.recursive)
  } else if (resources?.projectId) {
    const result = await fileRepo.find({ where: { projectId: String(resources.projectId) }, select: ['id'] })
    
    for (const row of result) {
      await addFileById(String(row.id))
    }
  }

  return out
}

/**
 * Build resource name from file and folder hierarchy
 * ✨ Migrated to TypeORM
 */
async function buildResourceName(f: { name: string; type: 'bpmn'|'dmn'; folderId: string | null }): Promise<string> {
  const parts: string[] = []
  let current = f.folderId
  const dataSource = await getDataSource()
  const folderRepo = dataSource.getRepository(Folder)
  
  while (current) {
    const row = await folderRepo.findOne({ where: { id: current }, select: ['name', 'parentFolderId'] })
    
    if (!row) break
    parts.unshift(sanitize(String(row.name)))
    current = row.parentFolderId ? String(row.parentFolderId) : null
  }
  
  const base = ensureExt(sanitize(f.name), f.type)
  parts.push(base)
  return parts.filter(Boolean).join('/')
}

async function inferDeployAuthIds(req: Request, res: Response, next: NextFunction) {
  try {
    const engineId = String(req.params.engineId)
    if (!engineId) {
      throw Errors.validation('engineId is required')
    }

    const resources = (req.body || {}).resources || {}
    const dataSource = await getDataSource()
    const fileRepo = dataSource.getRepository(FileEntity)
    const folderRepo = dataSource.getRepository(Folder)

    // Important: derive projectId from the actual resources being accessed.
    // Do not trust resources.projectId when fileIds/folderId are provided.
    let projectId: string | null = null

    if (Array.isArray(resources.fileIds) && resources.fileIds.length > 0) {
      const ids = resources.fileIds.map((x: any) => String(x))
      const rows = await fileRepo.find({ where: { id: In(ids) }, select: ['id', 'projectId'] })

      if (rows.length !== ids.length) {
        throw Errors.validation('fileIds array is required');
      }

      const uniq = new Set(rows.map((r: any) => String(r.projectId)))
      if (uniq.size !== 1) {
        throw Errors.validation('Resources must belong to a single project')
      }

      projectId = String(rows[0].projectId)
    } else if (resources.folderId) {
      const folderId = String(resources.folderId)
      const row = await folderRepo.findOne({ where: { id: folderId }, select: ['projectId'] })

      if (!row) {
        throw Errors.validation('fileIds array is required');
      }

      projectId = String(row.projectId)
    } else if (resources.projectId) {
      projectId = String(resources.projectId)
    }

    if (!projectId) {
      throw Errors.validation('resources with fileIds, folderId, or projectId required')
    }

    req.body = { ...(req.body || {}), projectId, engineId }
    return next()
  } catch (e) {
    throw Errors.internal('Failed to validate deployment request')
  }
}

r.post('/engines-api/engines/:engineId/deployments/preview', apiLimiter, requireAuth, validateBody(deployResourcesSchema), inferDeployAuthIds, requireDeployPermission(), asyncHandler(async (req: Request, res: Response) => {
  try {
    const files = await resolveFilesFromRequest(req)
    const resources: string[] = []
    const warnings: string[] = []
    const errors: string[] = []
    const seen = new Set<string>()
    for (const f of files) {
      const rn0 = await buildResourceName(f)
      let rn = rn0
      let counter = 1
      while (seen.has(rn)) {
        const m = rn0.match(/(\.[^.]+)$/)
        const ext = m ? m[1] : ''
        const base = ext ? rn0.slice(0, -ext.length) : rn0
        rn = `${base}.${(counter++).toString(36)}${ext}`
      }
      // Validation: ensure Camunda namespace on bpmn:definitions for BPMN files
      if (f.type === 'bpmn') {
        try {
          const defsMatch = f.xml.match(/<\s*bpmn:definitions[^>]*>/i)
          const defsTag = defsMatch ? defsMatch[0] : ''
          const hasCamundaNs = defsTag ? /xmlns:camunda\s*=\s*["']http:\/\/camunda\.org\/schema\/1\.0\/bpmn["']/i.test(defsTag) : /xmlns:camunda\s*=\s*["']http:\/\/camunda\.org\/schema\/1\.0\/bpmn["']/i.test(f.xml)
          if (!hasCamundaNs) {
            warnings.push(`Resource ${rn} is missing Camunda namespace on bpmn:definitions (expected xmlns:camunda="http://camunda.org/schema/1.0/bpmn").`)
          }
        } catch {}
      }
      // Validation: ensure DMN files have valid structure
      if (f.type === 'dmn') {
        try {
          // Check for definitions root element
          if (!/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i.test(f.xml)) {
            errors.push(`Resource ${rn} is missing DMN <definitions> root element.`)
          }
          // Check for DMN namespace (OMG spec allows various versions and MODEL or DC)
          if (!/xmlns(?::dmn)?\s*=\s*["']https?:\/\/www\.omg\.org\/spec\/DMN\/[^"']+["']/i.test(f.xml)) {
            errors.push(`Resource ${rn} is missing DMN namespace (expected xmlns="https://www.omg.org/spec/DMN/..." or similar).`)
          }

          const defsMatch = f.xml.match(/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i)
          const defsTag = defsMatch ? defsMatch[0] : ''
          if (defsTag) {
            const xmlnsMatches = Array.from(defsTag.matchAll(/\bxmlns(?::[a-zA-Z0-9_-]+)?\s*=\s*["']([^"']+)["']/gi))
            for (const m of xmlnsMatches) {
              const uri = String(m?.[1] || '')
              if (uri && /\s/.test(uri)) {
                errors.push(`Resource ${rn} has whitespace/newlines inside an XML namespace URI (xmlns). Fix the <definitions> xmlns declarations (namespace values must be a single uninterrupted URL).`)
                break
              }
            }

            const dmndiNs = defsTag.match(/\bxmlns:dmndi\s*=\s*["']([^"']+)["']/i)?.[1] || ''
            if (!dmndiNs.trim()) {
              errors.push(`Resource ${rn} is missing the xmlns:dmndi namespace declaration on <definitions>.`)
            }

            const idAttr = defsTag.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || ''
            const nsAttr = defsTag.match(/\bnamespace\s*=\s*["']([^"']+)["']/i)?.[1] || ''
            if (!idAttr.trim()) {
              errors.push(`Resource ${rn} DMN <definitions> is missing a non-empty id attribute.`)
            }
            if (!nsAttr.trim()) {
              errors.push(`Resource ${rn} DMN <definitions> is missing a non-empty namespace attribute.`)
            }
          }

          // Engine requirement: if camunda namespace exists, require historyTimeToLive on each decision
          if (/\bxmlns:camunda\s*=\s*["']/i.test(f.xml)) {
            const decisionTags = Array.from(f.xml.matchAll(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*>/gi)).map(m => m[0])
            const missingTtl = decisionTags.some(t => !/\bcamunda:historyTimeToLive\s*=\s*["']/i.test(t))
            if (missingTtl) {
              errors.push(`Resource ${rn} is missing camunda:historyTimeToLive on one or more <decision> elements. This engine requires a history TTL (e.g. camunda:historyTimeToLive="60").`)
            }
          }

          // If DMNDI is present, ensure diagram/shape ids exist (Camunda may reject DMNDI without ids)
          const hasDmndi = /<\s*(?:[a-zA-Z0-9_-]+:)?DMNDI\b/i.test(f.xml)
          if (hasDmndi) {
            const diagramTags = Array.from(f.xml.matchAll(/<\s*(?:[a-zA-Z0-9_-]+:)?DMNDiagram\b[^>]*>/gi)).map(m => m[0])
            const shapeTags = Array.from(f.xml.matchAll(/<\s*(?:[a-zA-Z0-9_-]+:)?DMNShape\b[^>]*>/gi)).map(m => m[0])

            const diagramMissingId = diagramTags.some(t => !/\bid\s*=\s*["']/i.test(t))
            const shapeMissingId = shapeTags.some(t => !/\bid\s*=\s*["']/i.test(t))

            if (diagramMissingId) {
              errors.push(`Resource ${rn} contains DMNDI but dmndi:DMNDiagram is missing an id attribute.`)
            }
            if (shapeMissingId) {
              errors.push(`Resource ${rn} contains DMNDI but dmndi:DMNShape is missing an id attribute.`)
            }
          }

          // Check for at least one decision element
          if (!/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*>/i.test(f.xml)) {
            errors.push(`Resource ${rn} does not contain any <decision> elements.`)
          }
          if (/<\s*(?:[a-zA-Z0-9_-]+:)?decisionTable\b/i.test(f.xml)) {
            if (!/<\s*(?:[a-zA-Z0-9_-]+:)?output\b/i.test(f.xml)) {
              errors.push(`Resource ${rn} decision table is missing an <output> column.`)
            }
            if (!/<\s*(?:[a-zA-Z0-9_-]+:)?rule\b/i.test(f.xml)) {
              errors.push(`Resource ${rn} decision table has no <rule> entries. Add at least one rule before deploying.`)
            }
            if (/<\s*(?:[a-zA-Z0-9_-]+:)?inputExpression\b[\s\S]*?<\s*(?:[a-zA-Z0-9_-]+:)?text\s*>\s*<\s*\/\s*(?:[a-zA-Z0-9_-]+:)?text\s*>/i.test(f.xml)) {
              warnings.push(`Resource ${rn} contains empty <inputExpression><text/> values. Ensure inputs are configured as intended.`)
            }
          } else if (/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b/i.test(f.xml)) {
            errors.push(`Resource ${rn} has a <decision> but no <decisionTable>. Add a decision table before deploying.`)
          }
        } catch {}
      }
      seen.add(rn)
      resources.push(rn)
    }
    res.json({ count: resources.length, resources, warnings, errors })
  } catch (e: any) {
    res.status(e?.status || 500).json({ message: e?.message || 'Preview failed' })
  }
}))

r.post('/engines-api/engines/:engineId/deployments', apiLimiter, requireAuth, validateBody(deployResourcesSchema), inferDeployAuthIds, requireDeployPermission(), asyncHandler(async (req: Request, res: Response) => {
  try {
    const engine = await getEngineById(String(req.params.engineId))
    const files = await resolveFilesFromRequest(req)

    for (const f of files) {
      if (f?.type !== 'dmn') continue
      const xml = String(f.xml || '')
      const hasDecision = /<\s*(?:[a-zA-Z0-9_-]+:)?decision\b/i.test(xml)
      const hasRule = /<\s*(?:[a-zA-Z0-9_-]+:)?rule\b/i.test(xml)
      if (!hasDecision) {
        return res.status(400).json({
          error: 'InvalidDmn',
          message: `DMN file "${String(f.name || 'DMN')}" is missing a <decision> element and cannot be deployed.`,
          hint: 'Add at least one decision to the DMN before deploying.',
          fileId: String(f.id || ''),
        })
      }
      if (!hasRule) {
        return res.status(400).json({
          error: 'InvalidDmn',
          message: `DMN file "${String(f.name || 'DMN')}" has no <rule> entries and cannot be deployed.`,
          hint: 'Add at least one rule to the decision table (even a placeholder rule), then deploy again.',
          fileId: String(f.id || ''),
        })
      }
    }
    const opts = Object(req.body?.options || {})
    const duplicate = opts.enableDuplicateFiltering !== false
    const changedOnly = opts.deployChangedOnly !== false // default true

    const deployContext = (req as { deployContext?: { projectId?: string; engineName?: string; environmentTag?: string } }).deployContext
    const body = req.body as DeployRequestBody
    const projectId = String(body?.projectId || '')
    const actualEngineId = String(body?.engineId || engine.id)

    const form = new FormData()
    if (opts.deploymentName) form.append('deployment-name', String(opts.deploymentName))
    form.append('enable-duplicate-filtering', String(duplicate))
    form.append('deploy-changed-only', String(changedOnly))
    if (opts.tenantId) form.append('tenant-id', String(opts.tenantId))

    const used = new Set<string>()
    const resourceMetaByName = new Map<string, { fileId: string; fileType: 'bpmn'|'dmn'; fileName: string; fileUpdatedAt: number | null; fileContentHash: string }>()
    for (const f of files) {
      if (f.type !== 'bpmn' && f.type !== 'dmn') continue
      const rn0 = await buildResourceName(f)
      let rn = rn0
      let counter = 1
      while (used.has(rn)) {
        const m = rn0.match(/(\.[^.]+)$/)
        const ext = m ? m[1] : ''
        const base = ext ? rn0.slice(0, -ext.length) : rn0
        rn = `${base}.${(counter++).toString(36)}${ext}`
      }
      used.add(rn)
      const file = new File([f.xml], rn, { type: 'application/xml' })
      // Camunda expects file parts as "data" with filename used as resource name
      form.append('data', file, rn)

      resourceMetaByName.set(rn, {
        fileId: String(f.id),
        fileType: f.type,
        fileName: String(f.name),
        fileUpdatedAt: f.updatedAt ?? null,
        fileContentHash: hashContent(String(f.xml || '')),
      })
    }

    const url = String(engine.baseUrl || '').replace(/\/$/, '') + '/deployment/create'
    const r2 = await fetch(url, { method: 'POST', headers: { ...authHeaders(engine) }, body: form as any })
    const text = await r2.text()
    if (!r2.ok) {
      try {
        const dmnMeta: DmnDebugMeta[] = []
        for (const f of files) {
          if (f.type !== 'dmn') continue
          const xml = String(f.xml || '')
          const defsMatch = xml.match(/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i)
          const defsTag = defsMatch ? defsMatch[0] : ''
          const rootTag = (xml.match(/<\s*((?:[a-zA-Z0-9_-]+:)?definitions)\b/i)?.[1] || '').trim()
          const xmlnsDefault = defsTag.match(/\bxmlns\s*=\s*["']([^"']+)["']/i)?.[1] || ''
          const xmlnsDmn = defsTag.match(/\bxmlns:dmn\s*=\s*["']([^"']+)["']/i)?.[1] || ''
          const nsAttr = defsTag.match(/\bnamespace\s*=\s*["']([^"']+)["']/i)?.[1] || ''
          const idAttr = defsTag.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || ''
          const decisionIds = Array.from(xml.matchAll(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/gi)).map(m => m[1]).slice(0, 10)
          dmnMeta.push({
            fileId: String(f.id || ''),
            fileName: String(f.name || ''),
            rootTag,
            xmlnsDefault,
            xmlnsDmn,
            namespace: nsAttr,
            definitionsId: idAttr,
            hasDecisionTable: /<\s*(?:[a-zA-Z0-9_-]+:)?decisionTable\b/i.test(xml),
            hasRule: /<\s*(?:[a-zA-Z0-9_-]+:)?rule\b/i.test(xml),
            decisionIds,
          })
        }
        logger.error('Camunda deployment failed', {
          engineId: String(engine.id),
          engineBaseUrl: String(engine.baseUrl || ''),
          status: r2.status,
          response: text,
          dmn: dmnMeta.length ? dmnMeta : undefined,
        })
      } catch {}
      return sendUpstream(res, r2.status, text)
    }
    let data: any = null
    try { data = JSON.parse(text) } catch { data = text }

    try {
      const dataSource = await getDataSource()
      const gitDeploymentRepo = dataSource.getRepository(GitDeployment)
      const engineDeploymentRepo = dataSource.getRepository(EngineDeployment)
      const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact)
      const now = Date.now()
      const deploymentRowId = generateId()

      let gitDeploymentId: string | null = null
      let gitCommitSha: string | null = null
      let gitCommitMessage: string | null = null

      const rawGitDeploymentId = typeof opts.gitDeploymentId === 'string' ? opts.gitDeploymentId : null
      const rawGitCommitSha = typeof opts.gitCommitSha === 'string' ? opts.gitCommitSha : null
      const rawGitCommitMessage = typeof opts.gitCommitMessage === 'string' ? opts.gitCommitMessage : null

      if (rawGitDeploymentId) {
        gitDeploymentId = rawGitDeploymentId
        try {
          const gd = await gitDeploymentRepo.findOne({
            where: { id: rawGitDeploymentId, projectId },
            select: ['id', 'commitSha', 'commitMessage']
          })
          if (gd) {
            gitCommitSha = gd.commitSha ? String(gd.commitSha) : rawGitCommitSha
            gitCommitMessage = gd.commitMessage ? String(gd.commitMessage) : rawGitCommitMessage
          } else {
            gitCommitSha = rawGitCommitSha
            gitCommitMessage = rawGitCommitMessage
          }
        } catch {
          gitCommitSha = rawGitCommitSha
          gitCommitMessage = rawGitCommitMessage
        }
      } else {
        gitCommitSha = rawGitCommitSha
        gitCommitMessage = rawGitCommitMessage
      }

      const lastCommitByFileId = new Map<string, { id: string; message: string }>()
      try {
        for (const f of files) {
          if (!f?.id) continue
          const fid = String((f as any).id)
          if (!fid) continue
          const last = await vcsService.getLastCommitForFile(projectId, fid)
          if (last && last.id) {
            lastCommitByFileId.set(fid, { id: String(last.id), message: String(last.message || '') })
          }
        }
      } catch {
        // Best-effort; VCS tables may not be configured
      }

      await engineDeploymentRepo.insert({
        id: deploymentRowId,
        projectId,
        engineId: actualEngineId,
        engineName: deployContext?.engineName ? String(deployContext.engineName) : null,
        environmentTag: deployContext?.environmentTag ? String(deployContext.environmentTag) : null,
        engineBaseUrl: engine.baseUrl,
        gitDeploymentId,
        gitCommitSha,
        gitCommitMessage,
        camundaDeploymentId: data && typeof data === 'object' && data.id ? String(data.id) : null,
        camundaDeploymentName: data && typeof data === 'object' && data.name ? String(data.name) : null,
        camundaDeploymentTime: data && typeof data === 'object' && data.deploymentTime ? String(data.deploymentTime) : null,
        deployedBy: req.user!.userId,
        deployedAt: now,
        enableDuplicateFiltering: !!duplicate,
        deployChangedOnly: !!changedOnly,
        resourceCount: used.size,
        status: 'success',
        errorMessage: null,
        rawResponse: JSON.stringify(data),
        createdAt: now,
        updatedAt: now,
      } as any)

      const artifactRows: any[] = []
      const defs: Array<{ kind: string; field: string }> = [
        { kind: 'process', field: 'deployedProcessDefinitions' },
        { kind: 'decision', field: 'deployedDecisionDefinitions' },
        { kind: 'drd', field: 'deployedDecisionRequirementsDefinitions' },
        { kind: 'case', field: 'deployedCaseDefinitions' },
      ]

      for (const [resourceName, meta] of resourceMetaByName.entries()) {
        const fileGit = meta?.fileId ? lastCommitByFileId.get(String(meta.fileId)) : null
        artifactRows.push({
          id: generateId(),
          engineDeploymentId: deploymentRowId,
          projectId,
          engineId: actualEngineId,
          fileId: meta ? meta.fileId : null,
          fileType: meta ? meta.fileType : null,
          fileName: meta ? meta.fileName : null,
          fileUpdatedAt: meta ? meta.fileUpdatedAt : null,
          fileContentHash: meta ? meta.fileContentHash : null,
          fileGitCommitId: fileGit ? fileGit.id : null,
          fileGitCommitMessage: fileGit ? fileGit.message : null,
          resourceName: resourceName || (meta ? meta.fileName : ''),
          artifactKind: 'resource',
          artifactId: resourceName || generateId(),
          artifactKey: resourceName || '',
          artifactVersion: 0,
          tenantId: opts.tenantId ? String(opts.tenantId) : null,
          createdAt: now,
        })
      }

      for (const { kind, field } of defs) {
        const typedData = data as DeploymentResponseData;
        const obj = typedData?.[field] as Record<string, CamundaDefinitionItem> | null;
        if (!obj || typeof obj !== 'object') continue
        for (const def of Object.values(obj)) {
          if (!def || typeof def !== 'object') continue
          const resourceName = String(def.resourceName || def.resource || '')
          const meta = resourceMetaByName.get(resourceName)
          const fileGit = meta?.fileId ? lastCommitByFileId.get(String(meta.fileId)) : null
          const versionRaw = def.version
          const version = typeof versionRaw === 'number' ? versionRaw : Number(versionRaw)
          if (!Number.isFinite(version)) continue

          artifactRows.push({
            id: generateId(),
            engineDeploymentId: deploymentRowId,
            projectId,
            engineId: actualEngineId,
            fileId: meta ? meta.fileId : null,
            fileType: meta ? meta.fileType : null,
            fileName: meta ? meta.fileName : null,
            fileUpdatedAt: meta ? meta.fileUpdatedAt : null,
            fileContentHash: meta ? meta.fileContentHash : null,
            fileGitCommitId: fileGit ? fileGit.id : null,
            fileGitCommitMessage: fileGit ? fileGit.message : null,
            resourceName: resourceName || (meta ? meta.fileName : ''),
            artifactKind: kind,
            artifactId: String(def.id || ''),
            artifactKey: String(def.key || ''),
            artifactVersion: version,
            tenantId: def.tenantId ? String(def.tenantId) : (opts.tenantId ? String(opts.tenantId) : null),
            createdAt: now,
          })
        }
      }

      if (artifactRows.length > 0) {
        await artifactRepo.insert(artifactRows as any)
      }
    } catch {
      // Best-effort persistence; do not fail the deployment if history recording fails
    }

    res.status(201).json({ engineId: engine.id, engineBaseUrl: engine.baseUrl, raw: data })
  } catch (e: any) {
    res.status(e?.status || 500).json({ message: e?.message || 'Deployment failed' })
  }
}))

// Passthroughs to engine for listing/reading/deleting deployments
r.get('/engines-api/engines/:engineId/deployments', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
const userId = req.user!.userId
const engineId = String(req.params.engineId)

if (!engineId || !(await engineService.hasEngineAccess(userId, engineId, ENGINE_VIEW_ROLES))) {
  throw Errors.engineNotFound();
}
try {
  const engine = await getEngineById(engineId)
  const url = new URL(String(engine.baseUrl || '').replace(/\/$/, '') + '/deployment')
  for (const [k,v] of Object.entries(req.query)) url.searchParams.set(k, String(v))
  const r2 = await fetch(url.toString(), { headers: { 'Content-Type': 'application/json', ...authHeaders(engine) } })
  const text = await r2.text()
  sendUpstream(res, r2.status, text)
} catch (e: any) {
  res.status(e?.status || 500).json({ message: e?.message || 'List deployments failed' })
}
}))

r.get('/engines-api/engines/:engineId/deployments/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
const userId = req.user!.userId
const engineId = String(req.params.engineId)

if (!engineId || !(await engineService.hasEngineAccess(userId, engineId, ENGINE_VIEW_ROLES))) {
  throw Errors.engineNotFound();
}
try {
  const engine = await getEngineById(engineId)
  const url = String(engine.baseUrl || '').replace(/\/$/, '') + `/deployment/${encodeURIComponent(String(req.params.id))}`
  const r2 = await fetch(url, { headers: { 'Content-Type': 'application/json', ...authHeaders(engine) } })
  const text = await r2.text()
  sendUpstream(res, r2.status, text)
} catch (e: any) {
  res.status(e?.status || 500).json({ message: e?.message || 'Get deployment failed' })
}
}))

r.delete('/engines-api/engines/:engineId/deployments/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
const userId = req.user!.userId
const engineId = String(req.params.engineId)

if (!engineId || !(await engineService.hasEngineAccess(userId, engineId, ENGINE_MANAGE_ROLES))) {
  throw Errors.engineNotFound();
}
try {
  const engine = await getEngineById(engineId)
  const cascade = req.query.cascade === 'true'
  const url = String(engine.baseUrl || '').replace(/\/$/, '') + `/deployment/${encodeURIComponent(String(req.params.id))}` + (cascade ? '?cascade=true' : '')
  const r2 = await fetch(url, { method: 'DELETE', headers: { ...authHeaders(engine) } })
  if (r2.status === 204) return res.status(204).end()
  const text = await r2.text()
  sendUpstream(res, r2.status, text)
} catch (e: any) {
  res.status(e?.status || 500).json({ message: e?.message || 'Delete deployment failed' })
}
}))

export default r
