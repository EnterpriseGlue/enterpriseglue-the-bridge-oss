import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { createLogger } from '@enterpriseglue/shared/utils/structuredLogger.js';

const logger = createLogger('config-bundle');

type Operation = 'validate' | 'apply';
type Status = 'validated' | 'applied' | 'accepted' | 'failed';

export function logConfigBundleResult(operation: Operation, status: Status, issueCode?: string): void {
  const failed = status === 'failed';
  logger.event(failed ? 'error' : 'info', 'Configuration bundle operation finished', {
    event: {
      action: operation === 'apply' ? 'config_bundle_apply' : 'config_bundle_validate',
      outcome: failed ? 'failure' : 'success',
      ...(issueCode && { code: issueCode }),
    },
    config_bundle: { status },
  });
}

export function logConfigBundleResponse(operation: Operation): RequestHandler {
  return (_req, res, next) => {
    res.once('finish', AsyncLocalStorage.bind(() => {
      if (res.statusCode >= 400) {
        logConfigBundleResult(operation, 'failed', operation === 'apply' ? 'apply_failed' : 'validation_failed');
      } else {
        logConfigBundleResult(operation, res.statusCode === 202 ? 'accepted' : operation === 'apply' ? 'applied' : 'validated');
      }
    }));
    next();
  };
}
