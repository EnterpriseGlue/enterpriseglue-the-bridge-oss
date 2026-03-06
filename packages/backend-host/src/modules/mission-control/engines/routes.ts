import { Router, Request, Response } from 'express'
import { generateId } from '@enterpriseglue/shared/utils/id.js'
import { z } from 'zod'
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js'
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js'
import { SavedFilter } from '@enterpriseglue/shared/db/entities/SavedFilter.js'
import { EngineHealth } from '@enterpriseglue/shared/db/entities/EngineHealth.js'
import { In, Not, IsNull } from 'typeorm'
import { fetch } from 'undici'
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js'
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { validateBody, validateParams } from '@enterpriseglue/shared/middleware/validate.js'
import { apiLimiter, engineLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js'
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js'
import { ENGINE_VIEW_ROLES, ENGINE_MANAGE_ROLES } from '@enterpriseglue/shared/constants/roles.js'
import { config } from '@enterpriseglue/shared/config/index.js'

// Validation schemas
const engineIdParamSchema = z.object({ id: z.string().min(1) })

const isLocalOrPrivate = (raw: string): boolean => {
  try {
    const host = new URL(raw).hostname
    // Private IPs, localhost, IPv6 loopback
    if (/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\])$/.test(host)) return true
    // Docker-internal: service names (no dots), host.docker.internal, *.local
    if (!host.includes('.') || host === 'host.docker.internal' || host.endsWith('.local')) return true
    return false
  } catch { return false }
}

const baseUrlSchema = z.string().min(1).url().refine(
  (url) => config.nodeEnv !== 'production' || url.startsWith('https://') || isLocalOrPrivate(url),
  { message: 'Engine base URL must use HTTPS in production (HTTP allowed for localhost/private networks)' }
)

const createEngineBodySchema = z.object({
  name: z.string().min(1).max(255),
  baseUrl: baseUrlSchema,
  type: z.string().default('camunda7'),
  authType: z.string().optional(),
  username: z.string().nullable().optional(),
  passwordEnc: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  environmentTagId: z.string().nullable().optional(),
})

const updateEngineBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  baseUrl: baseUrlSchema.optional(),
  type: z.string().optional(),
  authType: z.string().optional(),
  username: z.string().nullable().optional(),
  passwordEnc: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  environmentTagId: z.string().nullable().optional(),
})

const createSavedFilterBodySchema = z.object({
  name: z.string().min(1).max(255),
  engineId: z.string().min(1),
  defKeys: z.array(z.string()).default([]),
  version: z.string().nullable().optional(),
  active: z.boolean().default(false),
  incidents: z.boolean().default(false),
  completed: z.boolean().default(false),
  canceled: z.boolean().default(false),
})

const updateSavedFilterBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  engineId: z.string().min(1).optional(),
  defKeys: z.array(z.string()).optional(),
  version: z.string().nullable().optional(),
  active: z.boolean().optional(),
  incidents: z.boolean().optional(),
  completed: z.boolean().optional(),
  canceled: z.boolean().optional(),
})

const r = Router()

async function canViewEngine(req: Request, engineId: string): Promise<boolean> {
  return engineService.hasEngineAccess(req.user!.userId, engineId, ENGINE_VIEW_ROLES)
}

async function canManageEngine(req: Request, engineId: string): Promise<boolean> {
  return engineService.hasEngineAccess(req.user!.userId, engineId, ENGINE_MANAGE_ROLES)
}

function redactEngineSecrets<T extends { username?: string | null; passwordEnc?: string | null }>(engine: T): T {
  if (!engine) return engine
  return {
    ...engine,
    username: null,
    passwordEnc: null,
  }
}

r.get('/engines-api/engines', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const tenantId = req.tenant?.tenantId

  // Filter engines by tenant context (including null tenantId for legacy data)
  const userEngines = await engineService.getUserEngines(req.user!.userId, tenantId)
  res.json(userEngines.map(({ engine, role }) => {
    const out = { ...engine, myRole: role }
    if (role !== 'owner' && role !== 'delegate') return redactEngineSecrets(out)
    return out
  }))
}))

r.post('/engines-api/engines', engineLimiter, requireAuth, validateBody(createEngineBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const now = Date.now()
  const id = generateId()
  // Set tenantId from request context (OSS: default-tenant-id, EE: actual tenant)
  const tenantId = req.tenant?.tenantId || null
  const payload = {
    id,
    name: req.body.name,
    baseUrl: req.body.baseUrl,
    type: req.body.type,
    authType: req.body.authType || (req.body.username ? 'basic' : 'none'),
    username: req.body.username ?? null,
    passwordEnc: req.body.passwordEnc ?? null,
    ownerId: req.user!.userId,
    delegateId: null,
    version: req.body.version ?? null,
    environmentTagId: req.body.environmentTagId || null,
    environmentLocked: false,
    tenantId,
    createdAt: now,
    updatedAt: now,
  }
  await engineRepo.insert(payload)
  res.status(201).json(payload)
}))

r.get('/engines-api/engines/:id', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const engine = await engineRepo.findOneBy({ id: engineId })
  if (!engine) throw Errors.notFound('Engine')
  if (!(await canViewEngine(req, String(engine.id)))) throw Errors.forbidden()

  const role = await engineService.getEngineRole(req.user!.userId, String(engine.id))
  if (role !== 'owner' && role !== 'delegate') {
    return res.json(redactEngineSecrets(engine))
  }

  res.json(engine)
}))

r.put('/engines-api/engines/:id', engineLimiter, requireAuth, validateParams(engineIdParamSchema), validateBody(updateEngineBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const existing = await engineRepo.findOneBy({ id: engineId })
  if (!existing) throw Errors.notFound('Engine')
  if (!(await canManageEngine(req, String(existing.id)))) throw Errors.forbidden()

  const now = Date.now()
  const updates: any = {
    name: req.body.name,
    baseUrl: req.body.baseUrl,
    type: req.body.type,
    authType: req.body.authType,
    username: req.body.username,
    passwordEnc: req.body.passwordEnc,
    version: req.body.version,
    environmentTagId: req.body.environmentTagId || null,
    updatedAt: now,
  }
  await engineRepo.update({ id: engineId }, updates)
  const updated = await engineRepo.findOneBy({ id: engineId })
  if (!updated) throw Errors.notFound('Engine')
  res.json(updated)
}))

r.delete('/engines-api/engines/:id', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const engineId = String(req.params.id)
  const existing = await engineRepo.findOneBy({ id: engineId })
  if (!existing) throw Errors.notFound('Engine')
  if (!(await canManageEngine(req, String(existing.id)))) throw Errors.forbidden()
  await engineRepo.delete({ id: engineId })
  res.status(204).end()
}))

// Test connection and record health
r.post('/engines-api/engines/:id/test', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const healthRepo = dataSource.getRepository(EngineHealth)
  const engineId = String(req.params.id)
  const eng = await engineRepo.findOneBy({ id: engineId })
  if (!eng) throw Errors.notFound('Engine')

  if (!(await canManageEngine(req, String(eng.id)))) throw Errors.forbidden()
  const base = String(eng.baseUrl || '')
  const url = base.replace(/\/$/, '') + '/version'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (eng.username) {
    const token = Buffer.from(`${eng.username}:${eng.passwordEnc || ''}`).toString('base64')
    headers['Authorization'] = `Basic ${token}`
  }
  const started = Date.now()
  let status: 'connected'|'disconnected'|'unknown' = 'unknown'
  let version: string | null = null
  let message: string | null = null
  try {
    const r = await fetch(url, { method: 'GET', headers })
    const latencyMs = Date.now() - started
    if (r.ok) {
      status = 'connected'
      try { const data: any = await r.json(); version = data?.version || null } catch { version = null }
      await engineRepo.update({ id: engineId }, { version: version || null, updatedAt: Date.now() })
      const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message: null, checkedAt: Date.now() }
      await healthRepo.insert(rec)
      return res.json({ status, latencyMs, version, checkedAt: rec.checkedAt })
    } else {
      status = 'disconnected'
      message = `${r.status} ${r.statusText}`
      const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
      await healthRepo.insert(rec)
      return res.json({ status, latencyMs, version: null, message, checkedAt: rec.checkedAt })
    }
  } catch (e: any) {
    const latencyMs = Date.now() - started
    status = 'disconnected'
    message = e?.message || 'Failed to connect'
    const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
    await healthRepo.insert(rec)
    return res.json({ status, latencyMs, version: null, message, checkedAt: rec.checkedAt })
  }
}))

// Get last health entry
r.get('/engines-api/engines/:id/health', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const healthRepo = dataSource.getRepository(EngineHealth)
  // Check authorization (skip for __env__ which is public)
  const engineId = String(req.params.id)
  if (engineId !== '__env__' && !(await canViewEngine(req, engineId))) {
    throw Errors.forbidden()
  }
  if (engineId === '__env__') {
    const baseUrl = process.env.CAMUNDA_BASE_URL || 'http://localhost:8080/engine-rest'
    const started = Date.now()
    try {
      const r = await fetch(baseUrl.replace(/\/$/, '') + '/version', { headers: { 'Content-Type': 'application/json' } })
      const latencyMs = Date.now() - started
      if (r.ok) {
        let version: string | null = null
        try { const data: any = await r.json(); version = data?.version || null } catch {}
        return res.json({ id: 'env-health', engineId: '__env__', status: 'connected', latencyMs, message: null, checkedAt: Date.now(), version })
      } else {
        return res.json({ id: 'env-health', engineId: '__env__', status: 'disconnected', latencyMs, message: `${r.status} ${r.statusText}`, checkedAt: Date.now(), version: null })
      }
    } catch (e: any) {
      const latencyMs = Date.now() - started
      return res.json({ id: 'env-health', engineId: '__env__', status: 'disconnected', latencyMs, message: e?.message || 'Failed to connect', checkedAt: Date.now(), version: null })
    }
  }
  // Select all then sort in memory
  const rows = await healthRepo.find({ where: { engineId } })
  if (rows.length === 0) {
    // Auto-ping once if no health yet
    const eng = await engineRepo.findOneBy({ id: engineId })
    if (eng) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (eng.username) {
        const token = Buffer.from(`${eng.username}:${eng.passwordEnc || ''}`).toString('base64')
        headers['Authorization'] = `Basic ${token}`
      }
      const started = Date.now()
      try {
        const r = await fetch(String(eng.baseUrl || '').replace(/\/$/, '') + '/version', { headers })
        const latencyMs = Date.now() - started
        let version: string | null = null
        let status: 'connected' | 'disconnected' = 'disconnected'
        let message: string | null = null
        if (r.ok) {
          status = 'connected'
          try { const data: any = await r.json(); version = data?.version || null } catch {}
        } else {
          message = `${r.status} ${r.statusText}`
        }
        const rec = { id: generateId(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
        await healthRepo.insert(rec)
        if (version && !eng.version) await engineRepo.update({ id: eng.id }, { version, updatedAt: Date.now() })
        return res.json({ ...rec, version })
      } catch (e: any) {
        const latencyMs = Date.now() - started
        const rec = { id: generateId(), engineId: eng.id, status: 'disconnected' as const, latencyMs, message: e?.message || 'Failed to connect', checkedAt: Date.now() }
        await healthRepo.insert(rec)
        return res.json({ ...rec, version: null })
      }
    }
  }
  const last = rows.sort((a: any, b: any) => (b.checkedAt as number) - (a.checkedAt as number))[0]
  res.json(last || null)
}))

r.get('/engines-api/saved-filters', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const tenantId = req.tenant?.tenantId
  const userEngines = await engineService.getUserEngines(req.user!.userId, tenantId)
  const engineIds = userEngines.map((e) => String(e.engine.id))
  if (engineIds.length === 0) {
    return res.json([])
  }
  const rows = await filterRepo.find({ where: { engineId: In(engineIds) } })

  res.json(rows.map((row: any) => ({
    ...row,
    defKeys: JSON.parse(row.defKeys || '[]'),
  })))
}))

r.post('/engines-api/saved-filters', apiLimiter, requireAuth, validateBody(createSavedFilterBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const now = Date.now()
  const id = generateId()
  const { engineId, name, defKeys, version, active, incidents, completed, canceled } = req.body

  if (!(await canViewEngine(req, engineId))) throw Errors.forbidden()

  const payload = {
    id,
    name,
    engineId,
    defKeys: JSON.stringify(defKeys),
    version: version ?? null,
    active,
    incidents,
    completed,
    canceled,
    createdAt: now,
  }
  await filterRepo.insert(payload)
  res.status(201).json({ ...payload, defKeys: JSON.parse(payload.defKeys) })
}))

r.get('/engines-api/saved-filters/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const filterId = String(req.params.id)
  const filter = await filterRepo.findOneBy({ id: filterId })
  if (!filter) throw Errors.notFound('Saved filter')

  if (!(await canViewEngine(req, String(filter.engineId)))) throw Errors.forbidden()

  res.json({ ...filter, defKeys: JSON.parse(filter.defKeys || '[]') })
}))

r.put('/engines-api/saved-filters/:id', apiLimiter, requireAuth, validateParams(engineIdParamSchema), validateBody(updateSavedFilterBodySchema), asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const filterId = String(req.params.id)
  const existing = await filterRepo.findOneBy({ id: filterId })
  if (!existing) throw Errors.notFound('Saved filter')
  if (!(await canViewEngine(req, String(existing.engineId)))) throw Errors.forbidden()

  const newEngineId = req.body.engineId || null
  if (newEngineId && !(await canViewEngine(req, newEngineId))) throw Errors.forbidden()

  const updates: any = {
    name: req.body.name,
    engineId: newEngineId || undefined,
    defKeys: req.body.defKeys ? JSON.stringify(req.body.defKeys) : undefined,
    version: req.body.version,
    active: req.body.active,
    incidents: req.body.incidents,
    completed: req.body.completed,
    canceled: req.body.canceled,
  }
  await filterRepo.update({ id: filterId }, updates)
  const updated = await filterRepo.findOneBy({ id: filterId })
  if (!updated) throw Errors.notFound('Saved filter')
  res.json({ ...updated, defKeys: JSON.parse(updated.defKeys || '[]') })
}))

r.delete('/engines-api/saved-filters/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const filterId = String(req.params.id)
  const existing = await filterRepo.findOneBy({ id: filterId })
  if (!existing) throw Errors.notFound('Saved filter')
  if (!(await canViewEngine(req, String(existing.engineId)))) throw Errors.forbidden()
  await filterRepo.delete({ id: filterId })
  res.status(204).end()
}))

export default r
