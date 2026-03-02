/**
 * Database Middleware
 * Provides request-scoped database connection
 */

import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

// Extend Express Request type to include dataSource
declare global {
  namespace Express {
    interface Request {
      dataSource?: DataSource;
    }
  }
}

/**
 * Middleware to attach database connection to request
 * This avoids repeated getDataSource() calls in route handlers
 * 
 * Usage:
 *   app.use(attachDatabase);
 *   
 *   // In route handler:
 *   const ds = req.dataSource!;
 *   const repo = ds.getRepository(User);
 */
export async function attachDatabase(req: Request, res: Response, next: NextFunction) {
  try {
    req.dataSource = await getDataSource();
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Helper to get database from request with type safety
 * Throws if database is not attached (middleware not applied)
 */
export function getDb(req: Request): DataSource {
  if (!req.dataSource) {
    throw new Error('Database not attached to request. Ensure attachDatabase middleware is applied.');
  }
  return req.dataSource;
}
