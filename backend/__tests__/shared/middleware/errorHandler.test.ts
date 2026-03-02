import { describe, it, expect } from 'vitest';
import { AppError, Errors, ErrorCode } from '@enterpriseglue/shared/middleware/errorHandler.js';

describe('errorHandler', () => {
  describe('AppError', () => {
    it('creates error with code and status', () => {
      const error = new AppError(ErrorCode.NOT_FOUND, 'Resource not found', 404);
      expect(error.message).toBe('Resource not found');
      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.statusCode).toBe(404);
    });

    it('converts to JSON', () => {
      const error = new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid input', 400, { field: 'email' });
      const json = error.toJSON();
      expect(json.error).toBe('Invalid input');
      expect(json.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(json.details).toEqual({ field: 'email' });
    });
  });

  describe('Errors factory', () => {
    it('creates badRequest error', () => {
      const error = Errors.badRequest('Bad input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ErrorCode.BAD_REQUEST);
    });

    it('creates notFound error with resource name', () => {
      const error = Errors.notFound('User', 'user-123');
      expect(error.message).toContain('User');
      expect(error.message).toContain('user-123');
      expect(error.statusCode).toBe(404);
    });

    it('creates conflict error', () => {
      const error = Errors.conflict('Duplicate entry');
      expect(error.statusCode).toBe(409);
    });

    it('creates unauthorized error', () => {
      const error = Errors.unauthorized('Invalid token');
      expect(error.statusCode).toBe(401);
    });

    it('creates adminRequired error', () => {
      const error = Errors.adminRequired();
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('Admin');
    });

    it('creates resource-specific not found errors', () => {
      expect(Errors.projectNotFound('p1').message).toContain('Project');
      expect(Errors.fileNotFound('f1').message).toContain('File');
      expect(Errors.userNotFound('u1').message).toContain('User');
    });
  });
});
