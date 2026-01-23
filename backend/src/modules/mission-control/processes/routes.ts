import { Router, Request, Response } from 'express'
import { asyncHandler } from '@shared/middleware/errorHandler.js'
import { requireAuth } from '@shared/middleware/auth.js'
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js'
import {
  listProcessDefinitions,
  getProcessDefinition,
  getProcessDefinitionXml,
  getProcessDefinitionStatistics,
  startProcessInstance,
} from './service.js'

const r = Router()

r.use(requireAuth)

// List process definitions
r.get('/mission-control-api/process-definitions', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const { key, nameLike, latest } = req.query as { key?: string; nameLike?: string; latest?: string }
  const engineId = (req as any).engineId as string
  const data = await listProcessDefinitions(engineId, {
    key,
    nameLike,
    latestVersion: latest === 'true' || latest === '1',
  })
  res.json(data)
}))

// Get process definition by ID
r.get('/mission-control-api/process-definitions/:id', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const data = await getProcessDefinition(engineId, req.params.id)
  res.json(data)
}))

// Get process definition XML
r.get('/mission-control-api/process-definitions/:id/xml', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const data = await getProcessDefinitionXml(engineId, req.params.id)
  res.json(data)
}))

// Get process definition statistics (activity instance counts)
r.get('/mission-control-api/process-definitions/key/:key/statistics', requireEngineReadOrWrite({ engineIdFrom: 'query' }), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string
  const data = await getProcessDefinitionStatistics(engineId, req.params.key)
  res.json(data)
}))

// Start process instance
r.post('/mission-control-api/process-definitions/key/:key/start', requireEngineReadOrWrite({ engineIdFrom: 'body' }), asyncHandler(async (req: Request, res: Response) => {
  const { variables, businessKey } = req.body || {}
  const engineId = (req as any).engineId as string
  const data = await startProcessInstance(engineId, req.params.key, { variables, businessKey })
  res.json(data)
}))

export default r
