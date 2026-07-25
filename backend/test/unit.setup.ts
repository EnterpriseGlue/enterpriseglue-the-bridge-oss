import './setup.js';
import { vi } from 'vitest';

// Route unit suites provide deliberately narrow data-source doubles for the
// feature under test. Dedicated policy and integration suites use the real
// service; this mock keeps generic unit routes focused on their declared
// permission result rather than an undeclared policy repository fixture.
vi.mock('@enterpriseglue/shared/services/platform-admin/PolicyService.js', () => ({
  policyService: {
    evaluateGate: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' }),
  },
}));
