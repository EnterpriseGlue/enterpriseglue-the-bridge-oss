import { describe, expect, it } from 'vitest';
import {
  assertKnownAuthzAction,
  getAuthzResourceResolver,
  listAuthzActions,
} from '@enterpriseglue/shared/authz/permission-actions.js';

// AUTHZ_EXHAUSTIVE_ACTION_CONTRACT
//
// This suite is deliberately registry-driven. Every registered action gets a
// named test case, so registering a new action automatically creates a
// required allow/deny contract instead of silently lowering coverage.
describe('exhaustive authorization action contracts', () => {
  const actions = listAuthzActions();

  it('rejects an unknown action before a route can authorize it', () => {
    expect(() => assertKnownAuthzAction('test.unknown-action')).toThrow('Unknown authorization action');
  });

  for (const action of actions) {
    it(`covers ${action.actionId}`, () => {
      // Allow contract: the route/middleware may resolve this exact known
      // action and receives its canonical permission and resource type.
      expect(assertKnownAuthzAction(action.actionId)).toEqual(action);
      expect(action.permissionId).toMatch(/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/);

      // Deny contract: every configured route resolver fails closed when it
      // cannot resolve the target resource. This is the shared boundary used
      // by route-family integration tests below.
      for (const route of action.routes || []) {
        const resolver = getAuthzResourceResolver(route.resourceResolver);
        expect(resolver, `${action.actionId} ${route.method} ${route.route}`).toBeDefined();
        expect(resolver?.failureMode).toBe('deny');
      }
    });
  }
});
