import { describe, expect, it } from 'vitest';
import {
  AUTHZ_RESOURCE_TYPES,
  getAuthzActionDefinition,
  getAuthzResourceResolver,
  listAuthzActions,
  validateAuthzActionRegistry,
} from '@enterpriseglue/shared/authz/permission-actions.js';

describe('authorization action registry', () => {
  it('retains runtime-resource assignment targets while runtime routes resolve live engine lineage', () => {
    expect(AUTHZ_RESOURCE_TYPES).toEqual(expect.arrayContaining([
      'engine_runtime_resource',
      'engine_runtime_resource_set',
    ]));

    const runtimeActions = listAuthzActions().filter((action) => action.actionId.startsWith('engine.runtime.'));
    expect(runtimeActions.length).toBeGreaterThan(0);
    expect(runtimeActions.every((action) => action.resourceType === 'engine')).toBe(true);
    expect(runtimeActions.some((action) => action.routes?.some((route) => route.resourceResolver === 'engine.byId'))).toBe(true);
  });

  it('keeps identity mapping, configuration bundle, and deployment receipt actions registered with real resolvers', () => {
    for (const actionId of [
      'platform.sso.group-mappings.manage',
      'platform.config-bundles.view',
      'platform.config-bundles.preview',
      'platform.config-bundles.apply',
      'platform.config-bundles.export',
      'engine.deployment-receipts.create',
    ]) {
      const action = getAuthzActionDefinition(actionId);
      expect(action, actionId).toBeDefined();
      expect(action?.routes?.length).toBeGreaterThan(0);
      for (const route of action?.routes || []) {
        expect(getAuthzResourceResolver(route.resourceResolver), `${actionId}: ${route.resourceResolver}`).toBeDefined();
      }
    }
  });

  it('accepts the complete action and resolver registry without duplicate or dangling references', () => {
    expect(validateAuthzActionRegistry()).toEqual([]);
  });
});
