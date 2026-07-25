process.env.NODE_ENV = 'test';

import { vi } from 'vitest';

// Global mock for rate limiters - all limiters are no-ops in tests
vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
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
  configBundleLimiter: (_req: any, _res: any, next: any) => next(),
  identityAdminLimiter: (_req: any, _res: any, next: any) => next(),
  reconciliationLimiter: (_req: any, _res: any, next: any) => next(),
  engineRegistrationLimiter: (_req: any, _res: any, next: any) => next(),
  isNotificationsRequest: vi.fn().mockReturnValue(false),
  getClientIdentifier: vi.fn().mockReturnValue('test-client-id'),
}));

// Route suites provide deliberately narrow data-source doubles for the feature
// under test. Policy enforcement is covered by its dedicated service and
// middleware suites, so keep generic route tests focused on their declared
// permission result rather than requiring every fixture to emulate the policy
// repository as well.
vi.mock('@enterpriseglue/shared/services/platform-admin/PolicyService.js', () => ({
  policyService: {
    evaluateGate: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' }),
  },
}));
