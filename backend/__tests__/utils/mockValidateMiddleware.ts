import type { NextFunction, Request, Response } from 'express';

function passThrough(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

export const validateMiddlewareMock = {
  validateBody: () => passThrough,
  validateQuery: () => passThrough,
  validateParams: () => passThrough,
  validateResponse: () => passThrough,
};
