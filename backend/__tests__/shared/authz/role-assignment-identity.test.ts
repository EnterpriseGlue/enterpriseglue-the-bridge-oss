import { describe, expect, it } from 'vitest';
import {
  canonicalRoleAssignmentKey,
  normalizeRoleAssignmentSourceRef,
} from '@enterpriseglue/shared/authz/role-assignment-identity.js';

describe('canonical role assignment identity', () => {
  const base = {
    tenantId: null,
    principalType: 'user',
    principalId: 'user-1',
    roleId: 'system.engine.operator',
    scopeType: 'engine',
    scopeId: 'engine-1',
    source: 'manual',
    sourceRef: null,
  };

  it('treats absent source references consistently for unique identity', () => {
    expect(normalizeRoleAssignmentSourceRef(null)).toBe('');
    expect(canonicalRoleAssignmentKey(base)).toBe(canonicalRoleAssignmentKey({ ...base, sourceRef: '' }));
  });

  it('is collision-safe when values include the key separator', () => {
    const first = canonicalRoleAssignmentKey({ ...base, principalId: 'a|b', scopeId: 'c' });
    const second = canonicalRoleAssignmentKey({ ...base, principalId: 'a', scopeId: 'b|c' });

    expect(first).not.toBe(second);
  });

  it('changes for every authorization-relevant identity component', () => {
    const key = canonicalRoleAssignmentKey(base);
    expect(canonicalRoleAssignmentKey({ ...base, tenantId: 'tenant-1' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, principalType: 'group' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, principalId: 'user-2' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, roleId: 'system.engine.deployer' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, scopeType: 'engine_set' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, scopeId: 'engine-2' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, source: 'config' })).not.toBe(key);
    expect(canonicalRoleAssignmentKey({ ...base, source: 'sso', sourceRef: 'mapping-1' })).not.toBe(key);
  });
});
