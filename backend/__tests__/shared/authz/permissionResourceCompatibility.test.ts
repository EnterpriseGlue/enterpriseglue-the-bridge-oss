import { describe, expect, it } from 'vitest';
import {
  isPermissionCompatibleWithResourceType,
} from '@enterpriseglue/shared/authz/permission-actions.js';

describe('permission/resource compatibility', () => {
  it('accepts an exact resource scope and rejects an unrelated scope', () => {
    const permission = { key: 'platform:authz:check', scope: 'platform' as const };

    expect(isPermissionCompatibleWithResourceType(permission, 'platform')).toBe(true);
    expect(isPermissionCompatibleWithResourceType(permission, 'engine')).toBe(false);
  });

  it.each([
    'engine',
    'engine_set',
    'engine_runtime_resource',
    'engine_runtime_resource_set',
  ] as const)('allows engine permissions on %s scopes', (resourceType) => {
    expect(isPermissionCompatibleWithResourceType(
      { key: 'engine:instance:view', scope: 'engine' },
      resourceType,
    )).toBe(true);
  });

  it('only allows tenant-safe permissions on tenant scope', () => {
    expect(isPermissionCompatibleWithResourceType(
      { key: 'engine:instance:view', scope: 'engine', tenantSafe: true },
      'tenant',
    )).toBe(true);
    expect(isPermissionCompatibleWithResourceType(
      { key: 'engine:variables:write', scope: 'engine', tenantSafe: false },
      'tenant',
    )).toBe(false);
  });
});
