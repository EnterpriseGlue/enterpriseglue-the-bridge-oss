/**
 * Schema helper utilities for consistent data transformation patterns
 * Use these in Zod schema transforms and API responses
 */

/**
 * Convert bigint/number timestamp to JavaScript number
 * Handles null, undefined, string, and bigint inputs
 */
export function toTimestamp(value: number | bigint | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/**
 * Convert optional bigint/number timestamp to JavaScript number or undefined
 * Returns undefined for null/undefined inputs (for optional fields)
 */
export function toOptionalTimestamp(value: number | bigint | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  return Number(value);
}

/**
 * Convert nullable string to undefined for API responses
 * Use this for optional string fields that are null in DB
 */
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

/**
 * Convert undefined to null for database inserts
 * Use this when inserting optional fields that are nullable in DB
 */
export function undefinedToNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Standard API error response format
 */
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
  hint?: string;
}

/**
 * Create a standard API error response
 */
export function createApiError(
  error: string,
  message: string,
  details?: Record<string, unknown>,
  hint?: string
): ApiError {
  const result: ApiError = { error, message };
  if (details) result.details = details;
  if (hint) result.hint = hint;
  return result;
}

/**
 * Standard error codes for consistent API responses
 */
export const ErrorCodes = {
  // Auth errors
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  INVALID_TOKEN: 'InvalidToken',
  TOKEN_EXPIRED: 'TokenExpired',
  
  // Resource errors
  NOT_FOUND: 'NotFound',
  ALREADY_EXISTS: 'AlreadyExists',
  CONFLICT: 'Conflict',
  
  // Validation errors
  VALIDATION_ERROR: 'ValidationError',
  INVALID_INPUT: 'InvalidInput',
  MISSING_FIELD: 'MissingField',
  
  // Operation errors
  OPERATION_FAILED: 'OperationFailed',
  TIMEOUT: 'Timeout',
  RATE_LIMITED: 'RateLimited',
  
  // Domain-specific errors
  INVALID_BPMN: 'InvalidBpmn',
  INVALID_DMN: 'InvalidDmn',
  DEPLOY_FAILED: 'DeployFailed',
  ENGINE_UNREACHABLE: 'EngineUnreachable',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Helper functions for sending standardized error responses
 * Use these in route handlers for consistent error format
 */
import type { Response } from 'express';

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): void {
  res.status(status).json(createApiError(code, message, details));
}

export function sendNotFound(res: Response, resource: string, id?: string): void {
  const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
  sendError(res, 404, ErrorCodes.NOT_FOUND, message);
}

export function sendUnauthorized(res: Response, message = 'Authentication required'): void {
  sendError(res, 401, ErrorCodes.UNAUTHORIZED, message);
}

export function sendForbidden(res: Response, message = 'Access denied'): void {
  sendError(res, 403, ErrorCodes.FORBIDDEN, message);
}

export function sendValidationError(res: Response, message: string, details?: Record<string, unknown>): void {
  sendError(res, 400, ErrorCodes.VALIDATION_ERROR, message, details);
}

export function sendConflict(res: Response, message: string): void {
  sendError(res, 409, ErrorCodes.CONFLICT, message);
}

export function sendServerError(res: Response, message = 'Internal server error'): void {
  sendError(res, 500, ErrorCodes.OPERATION_FAILED, message);
}
