import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

/**
 * Standard error codes for the application
 */
export enum ErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  
  // Authentication specific
  NO_CREDENTIALS = 'NO_CREDENTIALS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Resource specific
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',
  RESOURCE_IN_USE = 'RESOURCE_IN_USE',
  
  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  CAMUNDA_ERROR = 'CAMUNDA_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * Application error class with error codes and status codes
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode | string,
    message: string,
    public statusCode: number = 500,
    public details?: any,
    public field?: string
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.field && { field: this.field }),
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * Factory functions for common errors
 */
export const Errors = {
  badRequest: (message: string, details?: any) =>
    new AppError(ErrorCode.BAD_REQUEST, message, 400, details),
  
  notFound: (resource: string, id?: string) =>
    new AppError(
      ErrorCode.NOT_FOUND,
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404
    ),
  
  conflict: (message: string, details?: any) =>
    new AppError(ErrorCode.CONFLICT, message, 409, details),
  
  validation: (message: string, details?: any) =>
    new AppError(ErrorCode.VALIDATION_ERROR, message, 400, details),
  
  internal: (message: string = 'Internal server error') =>
    new AppError(ErrorCode.INTERNAL_ERROR, message, 500),
  
  camunda: (message: string, details?: any) =>
    new AppError(ErrorCode.CAMUNDA_ERROR, message, 502, details),

  // Common error shortcuts
  unauthorized: (message: string = 'Authentication required') =>
    new AppError(ErrorCode.UNAUTHORIZED, message, 401),

  forbidden: (message: string = 'Access denied') =>
    new AppError(ErrorCode.FORBIDDEN, message, 403),

  adminRequired: () =>
    new AppError(ErrorCode.FORBIDDEN, 'Admin access required', 403),

  serviceUnavailable: (service: string) =>
    new AppError(ErrorCode.SERVICE_UNAVAILABLE, `${service} service unavailable`, 503),

  // Resource-specific not found errors
  projectNotFound: (id?: string) => Errors.notFound('Project', id),
  fileNotFound: (id?: string) => Errors.notFound('File', id),
  engineNotFound: (id?: string) => Errors.notFound('Engine', id),
  userNotFound: (id?: string) => Errors.notFound('User', id),
  tenantNotFound: (id?: string) => Errors.notFound('Tenant', id),
  providerNotFound: (id?: string) => Errors.notFound('Provider', id),

  // Authentication errors with codes
  noCredentials: (message: string = 'No credentials available') =>
    new AppError(ErrorCode.NO_CREDENTIALS, message, 401),
  
  invalidCredentials: (message: string = 'Invalid credentials') =>
    new AppError(ErrorCode.INVALID_CREDENTIALS, message, 401),
  
  authFailed: (message: string = 'Authentication failed') =>
    new AppError(ErrorCode.AUTH_FAILED, message, 401),
  
  tokenExpired: (message: string = 'Token expired') =>
    new AppError(ErrorCode.TOKEN_EXPIRED, message, 401),

  // Conflict errors with field support
  duplicate: (resource: string, field?: string) =>
    new AppError(
      ErrorCode.DUPLICATE_RESOURCE,
      `${resource} already exists`,
      409,
      undefined,
      field
    ),

  // Database errors
  database: (message: string = 'Database error') =>
    new AppError(ErrorCode.DATABASE_ERROR, message, 500),

  // Custom error with code (for flexibility)
  withCode: (code: string, message: string, statusCode: number = 400, field?: string) =>
    new AppError(code as ErrorCode, message, statusCode, undefined, field),
};

/**
 * Express error handling middleware
 * Must be registered AFTER all routes
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Handle AppError instances
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    });
  }

  // Log unexpected errors
  console.error('❌ Unexpected error:', err);

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: isDevelopment ? err.message : 'Internal server error',
      ...(isDevelopment && { stack: err.stack }),
    },
  });
}

/**
 * Async route handler wrapper to catch errors
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
