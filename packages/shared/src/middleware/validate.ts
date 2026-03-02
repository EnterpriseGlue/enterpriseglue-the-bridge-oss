import { z, ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Validation Middleware
 * 
 * Provides reusable middleware for validating request body, query params, and route params
 * using Zod schemas. Ensures consistent error handling and type safety across all routes.
 */

/**
 * Validate request body against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 * 
 * @example
 * router.post('/users', validateBody(createUserSchema), async (req, res) => {
 *   // req.body is now validated and typed
 *   const { email, name } = req.body;
 * });
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          issues: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * Validate query parameters against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 * 
 * @example
 * router.get('/users', validateQuery(paginationSchema), async (req, res) => {
 *   // req.query is now validated and typed
 *   const { page, limit } = req.query;
 * });
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          issues: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * Validate route parameters against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 * 
 * @example
 * router.get('/users/:id', validateParams(idParamSchema), async (req, res) => {
 *   // req.params is now validated and typed
 *   const { id } = req.params;
 * });
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid route parameters',
          issues: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * Validate response data against a Zod schema (development/testing only)
 * 
 * This middleware validates the response before sending it to the client.
 * Useful for catching bugs where the API sends incorrect data.
 * 
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 * 
 * @example
 * router.get('/users/:id', validateResponse(userSchema), async (req, res) => {
 *   const user = await getUser(req.params.id);
 *   res.json(user);  // Automatically validated before sending
 * });
 */
export function validateResponse<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data: any) {
      try {
        const validated = schema.parse(data);
        return originalJson(validated);
      } catch (error) {
        console.error('Response validation failed:', error);
        
        // In development, throw error to catch bugs
        if (process.env.NODE_ENV === 'development') {
          if (error instanceof ZodError) {
            return originalJson({
              error: 'Response validation failed (development only)',
              issues: error.errors.map(err => ({
                path: err.path.join('.'),
                message: err.message,
              })),
            });
          }
        }
        
        // In production, log error and send generic message
        console.error('Response validation error:', error);
        return originalJson({ error: 'Internal server error' });
      }
    };
    
    next();
  };
}
