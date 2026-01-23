import { Router, Request, Response } from 'express';
import { asyncHandler } from '@shared/middleware/errorHandler.js';
import { validateBody } from '@shared/middleware/validate.js';
import { requireAuth } from '@shared/middleware/auth.js';
import { requireEngineReadOrWrite } from '@shared/middleware/engineAuth.js';
import { sendMessage, sendSignal } from './messages-service.js';
import { CorrelateMessageRequest, SignalEventSchema } from '@shared/schemas/mission-control/message.js';

const r = Router();

r.use(requireAuth);

// Correlate message
r.post('/mission-control-api/messages', requireEngineReadOrWrite({ engineIdFrom: 'body' }), validateBody(CorrelateMessageRequest), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  const data = await sendMessage(engineId, req.body);
  res.json(data);
}));

// Deliver signal
r.post('/mission-control-api/signals', requireEngineReadOrWrite({ engineIdFrom: 'body' }), validateBody(SignalEventSchema), asyncHandler(async (req: Request, res: Response) => {
  const engineId = (req as any).engineId as string;
  await sendSignal(engineId, req.body);
  res.status(204).end();
}));

export default r;
