import { describe, expect, it } from 'vitest';
import {
  getAuthzResourceResolver,
  listAuthzActions,
  type AuthzActionDefinition,
  type AuthzRouteMetadata,
} from '@enterpriseglue/shared/authz/permission-actions.js';

type GeneratedRouteContract = {
  action: AuthzActionDefinition;
  route: AuthzRouteMetadata;
};

/**
 * This is intentionally derived from the registry instead of a handwritten
 * list: every new action route receives the same allow/deny contract on the
 * next test run. Route-specific integration tests still exercise side effects.
 */
function generatedRouteContracts(): GeneratedRouteContract[] {
  return listAuthzActions().flatMap((action) =>
    (action.routes || []).map((route) => ({ action, route }))
  );
}

describe('generated authorization action-route contracts', () => {
  const contracts = generatedRouteContracts();

  it('generates an allow and fail-closed deny contract for every registered action route', () => {
    expect(contracts.length).toBeGreaterThan(0);

    for (const { action, route } of contracts) {
      const resolver = getAuthzResourceResolver(route.resourceResolver);
      const label = `${action.actionId} ${route.method} ${route.route}`;

      // Allow: a route may use only a resolver registered in the same action
      // registry. Some catalogue routes intentionally authorize a narrower
      // action from a platform-level collection resolver, so the exact
      // resource mapping remains declarative in the action definition.
      expect(resolver, `${label} must resolve a registered resource`).toBeDefined();
      expect(resolver?.resourceType, `${label} resolver resource type`).toBeTruthy();

      // Deny: every resolver must reject an unresolved or foreign resource.
      expect(resolver?.failureMode, `${label} resolver failure mode`).toBe('deny');
    }
  });

  it('keeps generated route contract identities unique', () => {
    const ids = contracts.map(({ action, route }) => `${action.actionId}:${route.method}:${route.route}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
