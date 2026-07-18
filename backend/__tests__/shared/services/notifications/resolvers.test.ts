import { describe, it, expect } from 'vitest';
import { DefaultTenantResolver } from '@enterpriseglue/shared/services/notifications/resolvers.js';
import type { UserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';

describe('DefaultTenantResolver', () => {
  const resolver = new DefaultTenantResolver();
  const mockUser: UserJwtPayload = {
    userId: 'user-1',
    principalType: 'user',
    principalId: 'user-1',
    email: 'test@example.com',
    platformRole: 'user',
    type: 'access',
  };
  
  it('extracts tenantId from query param', () => {
    const result = resolver.resolve({
      user: mockUser,
      query: { tenantId: 'tenant-1' },
    });
    
    expect(result.tenantId).toBe('tenant-1');
    expect(result.userId).toBe('user-1');
  });
  
  it('extracts tenantId from header', () => {
    const req = { headers: { 'x-tenant-id': 'tenant-2' } } as any;
    const result = resolver.resolve({
      user: mockUser,
      req,
    });
    
    expect(result.tenantId).toBe('tenant-2');
  });
  
  it('prefers query param over header', () => {
    const req = { headers: { 'x-tenant-id': 'header-tenant' } } as any;
    const result = resolver.resolve({
      user: mockUser,
      req,
      query: { tenantId: 'query-tenant' },
    });
    
    expect(result.tenantId).toBe('query-tenant');
  });
  
  it('returns null tenantId when not provided', () => {
    const result = resolver.resolve({
      user: mockUser,
    });
    
    expect(result.tenantId).toBeNull();
    expect(result.userId).toBe('user-1');
  });
  
  it('throws when user is not provided', () => {
    expect(() => resolver.resolve({})).toThrow('User context required');
  });
});
