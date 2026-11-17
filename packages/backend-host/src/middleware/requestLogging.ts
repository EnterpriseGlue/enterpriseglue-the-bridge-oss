import type { Request, RequestHandler, Response } from 'express';
import morgan from 'morgan';
import { getBpmnEngineRequestContext, runWithBpmnEngineRequestContext } from '@enterpriseglue/shared/services/bpmn-engine-request-context.js';
import { createLogger, runWithLogContext, type LogContext } from '@enterpriseglue/shared/utils/structuredLogger.js';

const logger = createLogger('http');
const contexts = new WeakMap<Request, LogContext>();

function traceIdFromHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(value);
  if (!match || match[1] === '0'.repeat(32) || match[2] === '0'.repeat(16)) return undefined;
  return match[1];
}

const accessLog = morgan<Request, Response>((tokens, req, res) => {
  const status = tokens.status(req, res);
  const statusCode = status === undefined ? undefined : Number(status);
  const durationMs = tokens['total-time'](req, res, 6);
  const route: unknown = req.route?.path;
  const completed = res.writableFinished;

  // Completion can run on a socket callback outside the request's async scope.
  runWithLogContext(contexts.get(req) ?? {}, () => {
    logger.event('info', completed ? 'HTTP request completed' : 'HTTP request aborted', {
      event: {
        action: 'http_request',
        outcome: !completed || (statusCode !== undefined && statusCode >= 400) ? 'failure' : 'success',
        duration: durationMs === undefined ? undefined : Math.round(Number(durationMs) * 1_000_000),
      },
      http: {
        request: { method: req.method },
        ...(statusCode !== undefined && { response: { status_code: statusCode } }),
        // Use the registered route pattern. Raw paths and queries can carry tokens.
        ...(typeof route === 'string' && { route }),
      },
    });
  });
  return null;
});

export const requestLogging: RequestHandler = (req, res, next) => {
  const header = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId = (Array.isArray(header) ? header[0] : header)?.trim() || undefined;
  runWithBpmnEngineRequestContext({ requestId }, () => {
    const resolvedRequestId = getBpmnEngineRequestContext()?.requestId;
    const context = {
      requestId: resolvedRequestId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(resolvedRequestId) ? resolvedRequestId : undefined,
      traceId: traceIdFromHeader(req.headers.traceparent),
    };
    contexts.set(req, context);
    runWithLogContext(context, () => accessLog(req, res, next));
  });
};
