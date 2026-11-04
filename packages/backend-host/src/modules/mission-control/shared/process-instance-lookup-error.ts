import type { RequestHandler } from 'express'
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js'
import { BpmnEngineOperationError } from '@enterpriseglue/shared/services/bpmn-engine-client.js'

/** Classify only a definite, typed engine read 404 after ordinary authorization.
 * Authentication, transport, mutation and lookalike errors retain their identity. */
export function processInstanceLookupError(error: unknown): unknown {
  return error instanceof BpmnEngineOperationError
    && error.details?.engineStatus === 404
    && error.details?.operationClass === 'engine.read'
    ? Errors.notFound('Process instance')
    : error
}

export function withProcessInstanceLookupError(guard: RequestHandler): RequestHandler {
  return (req, res, next) => guard(req, res, error => next(processInstanceLookupError(error)))
}

export function rethrowProcessInstanceLookupError(error: unknown): never {
  throw processInstanceLookupError(error)
}
