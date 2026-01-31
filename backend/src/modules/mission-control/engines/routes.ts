import { Router, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { getDataSource } from '@shared/db/data-source.js'
import { Engine } from '@shared/db/entities/Engine.js'
import { SavedFilter } from '@shared/db/entities/SavedFilter.js'
import { EngineHealth } from '@shared/db/entities/EngineHealth.js'
import { In, Not, IsNull } from 'typeorm'
import { fetch } from 'undici'
import { requireAuth } from '@shared/middleware/auth.js'
import { asyncHandler, Errors } from '@shared/middleware/errorHandler.js'
import { apiLimiter, engineLimiter } from '@shared/middleware/rateLimiter.js'
import { engineService } from '@shared/services/platform-admin/index.js'
import { ENGINE_VIEW_ROLES, ENGINE_MANAGE_ROLES } from '@shared/constants/roles.js'

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

r.post('/engines-api/engines', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const now = Date.now()
  const id = randomUUID()
  // Set tenantId from request context (OSS: default-tenant-id, EE: actual tenant)
  const tenantId = req.tenant?.tenantId || null
  const payload = {
    id,
    name: String(req.body?.name || ''),
    baseUrl: String(req.body?.baseUrl || ''),
    type: String(req.body?.type || 'camunda7'),
    authType: String(req.body?.authType || (req.body?.username ? 'basic' : 'none')),
    username: req.body?.username ?? null,
    passwordEnc: req.body?.passwordEnc ?? null,
    ownerId: req.user!.userId,
    delegateId: null,
    version: req.body?.version ?? null,
    environmentTagId: req.body?.environmentTagId || null,
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
  const rows = await engineRepo.find({ where: { id: req.params.id } })
  if (!rows.length) throw Errors.notFound('Engine')
  if (!(await canViewEngine(req, String(rows[0].id)))) throw Errors.forbidden()

  const role = await engineService.getEngineRole(req.user!.userId, String(rows[0].id))
  if (role !== 'owner' && role !== 'delegate') {
    return res.json(redactEngineSecrets(rows[0]))
  }

  res.json(rows[0])
}))

r.put('/engines-api/engines/:id', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const existing = await engineRepo.find({ where: { id: req.params.id }, take: 1 })
  if (!existing.length) throw Errors.notFound('Engine')
  if (!(await canManageEngine(req, String(existing[0].id)))) throw Errors.forbidden()

  const now = Date.now()
  const updates: any = {
    name: req.body?.name,
    baseUrl: req.body?.baseUrl,
    type: req.body?.type,
    authType: req.body?.authType,
    username: req.body?.username,
    passwordEnc: req.body?.passwordEnc,
    version: req.body?.version,
    environmentTagId: req.body?.environmentTagId || null,
    updatedAt: now,
  }
  await engineRepo.update({ id: req.params.id }, updates)
  const rows = await engineRepo.find({ where: { id: req.params.id } })
  if (!rows.length) throw Errors.notFound('Engine')
  res.json(rows[0])
}))

r.delete('/engines-api/engines/:id', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const existing = await engineRepo.find({ where: { id: req.params.id }, take: 1 })
  if (!existing.length) throw Errors.notFound('Engine')
  if (!(await canManageEngine(req, String(existing[0].id)))) throw Errors.forbidden()
  await engineRepo.delete({ id: req.params.id })
  res.status(204).end()
}))

// Test connection and record health
r.post('/engines-api/engines/:id/test', engineLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const engineRepo = dataSource.getRepository(Engine)
  const healthRepo = dataSource.getRepository(EngineHealth)
  const rows = await engineRepo.find({ where: { id: req.params.id } })
  if (!rows.length) throw Errors.notFound('Engine')

  if (!(await canManageEngine(req, String(rows[0].id)))) throw Errors.forbidden()
  const eng = rows[0]
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
      await engineRepo.update({ id: req.params.id }, { version: version || null, updatedAt: Date.now() })
      const rec = { id: randomUUID(), engineId: eng.id, status, latencyMs, message: null, checkedAt: Date.now() }
      await healthRepo.insert(rec)
      return res.json({ status, latencyMs, version, checkedAt: rec.checkedAt })
    } else {
      status = 'disconnected'
      message = `${r.status} ${r.statusText}`
      const rec = { id: randomUUID(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
      await healthRepo.insert(rec)
      return res.json({ status, latencyMs, version: null, message, checkedAt: rec.checkedAt })
    }
  } catch (e: any) {
    const latencyMs = Date.now() - started
    status = 'disconnected'
    message = e?.message || 'Failed to connect'
    const rec = { id: randomUUID(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
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
  if (req.params.id !== '__env__' && !(await canViewEngine(req, req.params.id))) {
    throw Errors.forbidden()
  }
  if (req.params.id === '__env__') {
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
  const rows = await healthRepo.find({ where: { engineId: req.params.id } })
  if (rows.length === 0) {
    // Auto-ping once if no health yet
    const engRows = await engineRepo.find({ where: { id: req.params.id } })
    const eng = engRows[0]
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
        const rec = { id: randomUUID(), engineId: eng.id, status, latencyMs, message, checkedAt: Date.now() }
        await healthRepo.insert(rec)
        if (version && !eng.version) await engineRepo.update({ id: eng.id }, { version, updatedAt: Date.now() })
        return res.json({ ...rec, version })
      } catch (e: any) {
        const latencyMs = Date.now() - started
        const rec = { id: randomUUID(), engineId: eng.id, status: 'disconnected' as const, latencyMs, message: e?.message || 'Failed to connect', checkedAt: Date.now() }
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

r.post('/engines-api/saved-filters', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const now = Date.now()
  const id = randomUUID()
  const engineId = String(req.body?.engineId || '')
  if (!engineId) throw Errors.validation('engineId is required');

  if (!(await canViewEngine(req, engineId))) throw Errors.forbidden()

  const payload = {
    id,
    name: String(req.body?.name || ''),
    engineId,
    defKeys: JSON.stringify(req.body?.defKeys || []),
    version: req.body?.version ?? null,
    active: !!req.body?.active,
    incidents: !!req.body?.incidents,
    completed: !!req.body?.completed,
    canceled: !!req.body?.canceled,
    createdAt: now,
  }
  await filterRepo.insert(payload)
  res.status(201).json({ ...payload, defKeys: JSON.parse(payload.defKeys) })
}))

r.get('/engines-api/saved-filters/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const rows = await filterRepo.find({ where: { id: req.params.id } })
  if (!rows.length) throw Errors.notFound('Engine')
  const row = rows[0]

  if (!(await canViewEngine(req, String(row.engineId)))) throw Errors.forbidden()

  res.json({ ...row, defKeys: JSON.parse(row.defKeys || '[]') })
}))

r.put('/engines-api/saved-filters/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const existing = await filterRepo.find({ where: { id: req.params.id }, take: 1 })
  if (!existing.length) throw Errors.notFound('Engine')
  if (!(await canViewEngine(req, String(existing[0].engineId)))) throw Errors.forbidden()

  const newEngineId = typeof req.body?.engineId === 'string' && req.body.engineId.trim() ? String(req.body.engineId) : null
  if (newEngineId && !(await canViewEngine(req, newEngineId))) throw Errors.forbidden()

  const updates: any = {
    name: req.body?.name,
    engineId: newEngineId || undefined,
    defKeys: req.body?.defKeys ? JSON.stringify(req.body.defKeys) : undefined,
    version: req.body?.version,
    active: req.body?.active,
    incidents: req.body?.incidents,
    completed: req.body?.completed,
    canceled: req.body?.canceled,
  }
  await filterRepo.update({ id: req.params.id }, updates)
  const rows = await filterRepo.find({ where: { id: req.params.id } })
  if (!rows.length) throw Errors.notFound('Engine')
  const row = rows[0]
  res.json({ ...row, defKeys: JSON.parse(row.defKeys || '[]') })
}))

r.delete('/engines-api/saved-filters/:id', apiLimiter, requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const dataSource = await getDataSource()
  const filterRepo = dataSource.getRepository(SavedFilter)
  const existing = await filterRepo.find({ where: { id: req.params.id }, take: 1 })
  if (!existing.length) throw Errors.notFound('Engine')
  if (!(await canViewEngine(req, String(existing[0].engineId)))) throw Errors.forbidden()
  await filterRepo.delete({ id: req.params.id })
  res.status(204).end()
}))

export default r
