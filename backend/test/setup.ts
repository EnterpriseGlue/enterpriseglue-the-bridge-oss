process.env.NODE_ENV = 'test';

import { vi } from 'vitest';

// Global mock for rate limiters - all limiters are no-ops in tests
vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetVerifyLimiter: (_req: any, _res: any, next: any) => next(),
  fileOperationsLimiter: (_req: any, _res: any, next: any) => next(),
  projectCreateLimiter: (_req: any, _res: any, next: any) => next(),
  createUserLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
  auditLimiter: (_req: any, _res: any, next: any) => next(),
  notificationsLimiter: (_req: any, _res: any, next: any) => next(),
  dashboardLimiter: (_req: any, _res: any, next: any) => next(),
  missionControlLimiter: (_req: any, _res: any, next: any) => next(),
  isNotificationsRequest: vi.fn().mockReturnValue(false),
  getClientIdentifier: vi.fn().mockReturnValue('test-client-id'),
}));
